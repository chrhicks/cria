/**
 * Scenarios a simulator can't produce on demand, against a fake INDI server:
 * drivers that never answer, refuse, ignore an abort, vanish, or lose the
 * connection, plus a Pegasus-like power box. Each one checks what Vela is
 * told and whether the device is blocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera, connection, exposeNormally, fitsFrame } from './fake-indi.js'
import { Effect, Option } from 'effect'
import { allReady, noneNotRead, startCria, until, type Cria } from './harness.js'

const camera = 'Fake CCD'
let fake: FakeIndi
let cria: Cria

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.behaviour = exposeNormally()
  cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['primary']))
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

const exposures = () => fake.received.filter(xml => xml.includes('name="CCD_EXPOSURE"')).length
const exposing = () => until('the fake camera to expose', () => fake.vector(camera, 'CCD_EXPOSURE').state === 'Busy', 5000)

describe('a camera that misbehaves', () => {
  it('converts the FITS frame to column-major ImageBytes with the colour at the subframe origin', async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })

    expect(operation).toMatchObject({ kind: 'confirmed', image: { width: 8, height: 6, color: 'grbg' } })
    const bytes = Buffer.from(await (await fetch(cria.base + operation.image!.original.url)).arrayBuffer())
    const pixel = (x: number, y: number) => bytes.readUInt16LE(44 + (x * 6 + y) * 2)

    expect([pixel(0, 0), pixel(3, 0), pixel(0, 2), pixel(7, 5)]).toEqual([0, 3, 20, 57])
  })

  it('never answers an exposure: uncertain, sent once, and the camera is blocked until a person recovers it', async () => {
    fake.behaviour = (_fake, vector) => (vector.name === 'CCD_EXPOSURE' ? 'handled' : 'default')
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(exposures()).toBe(1)

    const blocked = await cria.device('primary')
    const refused = await cria.submit('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(blocked).toMatchObject({ quarantine: { held: true }, availability: { ready: false, reason: 'blocked' } })
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'device-blocked' } } })
    expect(exposures()).toBe(1)

    const state = await cria.state()
    const wrongBinding = await cria.client.recover('primary', {
      instanceId: state.instanceId,
      bindingId: crypto.randomUUID(),
      externalRecoveryConfirmed: true,
      note: 'checked',
    })
    const recovered = await cria.client.recover('primary', {
      instanceId: state.instanceId,
      bindingId: blocked.bindingId,
      externalRecoveryConfirmed: true,
      note: 'Chris checked the camera: idle',
    })

    expect(wrongBinding.status).toBe(409)
    expect(recovered.status).toBe(200)
    expect(recovered.body.bindingId).not.toBe(blocked.bindingId)

    const history = await cria.client.operation(operation.id)

    expect(history.body).toMatchObject({ recovery: { note: 'Chris checked the camera: idle' } })

    fake.update(camera, 'CCD_EXPOSURE', { state: 'Idle' })
    fake.behaviour = exposeNormally()
    await cria.waitFor(allReady(['primary']))
    expect((await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })).kind).toBe('confirmed')
  })

  it('refuses an exposure with Alert: failed, not blocked', async () => {
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_EXPOSURE') return 'default'
      fake.update(camera, 'CCD_EXPOSURE', { state: 'Alert', message: 'exposure out of range' })

      return 'handled'
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled', quarantined: false })
    expect(operation.message).toMatch(/exposure out of range/)
    expect((await cria.device('primary')).quarantine.held).toBe(false)
  })

  it('ignores the abort: the cancelled capture is uncertain (stop not confirmed), never "cancelled"', async () => {
    const normal = exposeNormally()

    fake.behaviour = (fake, vector, values) => {
      if (vector.name === 'CCD_ABORT_EXPOSURE') {
        fake.update(camera, vector.name, { state: 'Ok' })

        return 'handled'
      }

      return normal(fake, vector, values)
    }
    const submitted = await cria.submit('primary', 'capture', { exposureSeconds: 60, light: true })

    await exposing()
    await cria.cancel(submitted.body.id)
    const operation = await cria.settled(submitted.body.id, 30_000)

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(operation.message).toMatch(/stop was not confirmed/)
  }, 40_000)

  it('vanishes mid-exposure (driver crashed): uncertain, blocked, readings unavailable', async () => {
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_EXPOSURE') return 'default'
      fake.update(camera, 'CCD_EXPOSURE', { state: 'Busy' })
      setTimeout(() => fake.removeDevice(camera), 200)

      return 'handled'
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 5, light: true })

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(operation.message).toMatch(/went away/)
    expect((await cria.device('primary')).readings.temperatureC).toEqual({ status: 'unavailable', reason: 'failed', message: 'Fake CCD is not defined by indiserver' })
  })

  it('loses the indiserver connection mid-exposure: uncertain; readings stale, then current again after reconnecting', async () => {
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_EXPOSURE') return 'default'
      fake.update(camera, 'CCD_EXPOSURE', { state: 'Busy' })
      setTimeout(() => fake.dropConnections(), 200)

      return 'handled'
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 5, light: true })

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(operation.message).toMatch(/connection lost/)

    const reconnected = await cria.waitFor(state => state.devices[0]!.readings.connected!.status === 'fresh')

    expect(reconnected.devices[0]!.quarantine.held).toBe(true)
    expect(exposures()).toBe(1)
  })

  it('keeps trying the abort until indiserver is back, within the stop deadline (review R1-#2)', async () => {
    const normal = exposeNormally()

    fake.behaviour = (fake, vector, values) => {
      if (vector.name === 'CCD_EXPOSURE') setTimeout(() => fake.dropConnections(), 200)

      return normal(fake, vector, values)
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 60, light: true })
    const aborts = fake.received.filter(xml => xml.includes('name="CCD_ABORT_EXPOSURE"'))

    expect(aborts).toHaveLength(1)
    expect(fake.vector(camera, 'CCD_EXPOSURE').state).toBe('Alert')
    expect(operation).toMatchObject({ kind: 'uncertain', reason: 'connection-lost', message: 'indiserver connection lost during the exposure', quarantined: true })
  })

  it('stops answering: readings turn stale and the camera is not command-ready, without any command sent', async () => {
    fake.answering = false
    const state = await cria.waitFor(current => current.devices[0]!.readings.connected!.status === 'stale', 10_000)

    expect(state.devices[0]!.availability).toEqual({ ready: false, reason: 'stale', message: 'The driver is not answering' })
    expect(state.devices[0]!.readings.connected!.value).toBe(true)
    expect(exposures()).toBe(0)
  })

  it('adjusts a requested subframe: failed with what the driver chose, not uncertain', async () => {
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'CCD_FRAME') return 'default'
      fake.apply(vector, values)
      fake.update(camera, 'CCD_FRAME', { state: 'Ok', values: { WIDTH: 4 } })

      return 'handled'
    }
    const operation = await cria.run('primary', 'camera-configure', { width: 5 })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled', quarantined: false })
    expect(operation.message).toMatch(/WIDTH=4/)
  })
})

describe('evidence from the driver (review R1-#8, #9, #10)', () => {
  it('#8: an Alert that was already there before the send is not a rejection', async () => {
    fake.update(camera, 'CCD_FRAME_TYPE', { state: 'Alert' })
    await until('Cria to see the Alert', () =>
      Option.match(Effect.runSync(cria.service.rig.client.device(camera).property('CCD_FRAME_TYPE')), { onNone: () => false, onSome: property => property.state === 'Alert' }),
    )
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_FRAME_TYPE') return 'default'
      fake.update(camera, 'CCD_FRAME_TYPE', { state: 'Alert' })

      return 'handled'
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.1, light: false })

    expect([operation.kind, operation.reason, operation.message]).toEqual(['uncertain', 'no-acknowledgement', 'CCD_FRAME_TYPE on Fake CCD: no answer within 600ms'])
    expect(exposures()).toBe(0)
  })

  const withSetpoint = () =>
    fake.define({ device: camera, name: 'CCD_TEMPERATURE', kind: 'number', perm: 'rw', state: 'Idle', elements: { CCD_TEMPERATURE_VALUE: { value: 20, min: -50, max: 50 } } })

  it('#9: a routine temperature update is not evidence the setpoint was taken', async () => {
    withSetpoint()
    await cria.waitFor(noneNotRead)
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_TEMPERATURE') return 'default'
      setTimeout(() => fake.update(camera, 'CCD_TEMPERATURE', { state: 'Idle', values: { CCD_TEMPERATURE_VALUE: 19.9 } }), 50)

      return 'handled'
    }
    const operation = await cria.run('primary', 'cooling', { setpointC: -10 })

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
  })

  it('#9: the driver starting to regulate (Busy) confirms the setpoint', async () => {
    withSetpoint()
    await cria.waitFor(noneNotRead)
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_TEMPERATURE') return 'default'
      fake.update(camera, 'CCD_TEMPERATURE', { state: 'Busy' })

      return 'handled'
    }

    expect(await cria.run('primary', 'cooling', { setpointC: -10 })).toMatchObject({ kind: 'confirmed', values: { setpointC: -10 } })
  })

  it('#10: waits for the driver to echo a number setting', async () => {
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'CCD_BINNING') return 'default'
      fake.update(camera, 'CCD_BINNING', { state: 'Ok' })
      setTimeout(() => {
        fake.apply(vector, values)
        fake.update(camera, 'CCD_BINNING', { state: 'Ok' })
      }, 1500)

      return 'handled'
    }

    expect(await cria.run('primary', 'camera-configure', { binX: 2, binY: 2, width: 4, height: 3 })).toMatchObject({ kind: 'confirmed' })
  })

  it('#10: old values at the deadline are uncertain, not "rejected"', async () => {
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_BINNING') return 'default'
      fake.update(camera, 'CCD_BINNING', { state: 'Ok' })

      return 'handled'
    }

    expect(await cria.run('primary', 'camera-configure', { binX: 2, binY: 2, width: 4, height: 3 })).toMatchObject({ kind: 'uncertain', quarantined: true })
  }, 30_000)
})

describe("a capture takes only its own frame (review R1-#7)", () => {
  const firstPixel = async (url: string) => Buffer.from(await (await fetch(cria.base + url)).arrayBuffer()).readUInt16LE(44)

  it('ignores a frame from another client (different exposure time) that arrives during its exposure', async () => {
    const normal = exposeNormally()

    fake.behaviour = (fake, vector, values) => {
      if (vector.name === 'CCD_EXPOSURE') setTimeout(() => fake.sendBlob(camera, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: 0.5, base: 1000 })), 50)

      return normal(fake, vector, values)
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.3, light: true })

    expect(operation.kind).toBe('confirmed')
    expect(await firstPixel(operation.image!.original.url)).toBe(0)
  })

  it('ignores a late frame that arrives before its own exposure went Busy', async () => {
    const normal = exposeNormally()

    fake.behaviour = (fake, vector, values) => {
      if (vector.name === 'CCD_EXPOSURE') fake.sendBlob(camera, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: Number(values.CCD_EXPOSURE_VALUE), base: 2000 }))

      return normal(fake, vector, values)
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.3, light: true })

    expect(operation.kind).toBe('confirmed')
    expect(await firstPixel(operation.image!.original.url)).toBe(0)
  })

  it('when only frames that are not its own arrive, ends uncertain at the deadline', async () => {
    const strict = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600, readoutAllowanceMs: 1000 })

    try {
      await strict.waitFor(allReady(['primary']))
      fake.behaviour = (fake, vector, values) => {
        if (vector.name !== 'CCD_EXPOSURE') return exposeNormally()(fake, vector, values)
        fake.update(camera, vector.name, { state: 'Busy' })
        setTimeout(() => fake.sendBlob(camera, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: 7 })), 100)

        return 'handled'
      }
      const operation = await strict.run('primary', 'capture', { exposureSeconds: 0.2, light: true })

      expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
      expect(operation.message).toMatch(/not this exposure/)
    } finally {
      await strict.stop()
    }
  })
})

describe('a cancel that arrives during a setting (review R1-#1)', () => {
  it('reports the setting that took effect, not "cancelled", and does not block', async () => {
    const box = 'Slow PPB'

    fake.define(connection(box))
    fake.define({ device: box, name: 'POWER_CHANNELS', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { POWER_CHANNEL_1: { value: true } } })
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'POWER_CHANNELS') return 'default'
      setTimeout(() => {
        fake.apply(vector, values)
        fake.update(box, vector.name, { state: 'Ok' })
      }, 300)

      return 'handled'
    }

    const power = await startCria(fake.port, [{ id: 'switch', kind: 'switch', indiDevice: box, channels: [{ name: '12V', property: 'POWER_CHANNELS', element: 'POWER_CHANNEL_1' }] }])

    try {
      await power.waitFor(allReady(['switch']))
      const submitted = await power.submit('switch', 'switch-set', { channelId: 0, value: 0 })

      await until('the switch command to reach the driver', () => fake.received.some(xml => xml.startsWith('<newSwitchVector') && xml.includes(`device="${box}"`)), 5000)
      await power.cancel(submitted.body.id)
      const operation = await power.settled(submitted.body.id)

      expect(fake.vector(box, 'POWER_CHANNELS').elements.POWER_CHANNEL_1!.value).toBe(false)
      expect(operation).toMatchObject({ kind: 'confirmed', state: 'settled', quarantined: false })
    } finally {
      await power.stop()
    }
  })
})

describe('a Pegasus-like power box', () => {
  it('switches the 12 V channel with readback, and refuses an off-grid dew value before sending', async () => {
    const box = 'Fake PPB'

    fake.define(connection(box))
    fake.define({ device: box, name: 'POWER_CHANNELS', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { POWER_CHANNEL_1: { value: true } } })
    fake.define({ device: box, name: 'DEW_PWM', kind: 'number', perm: 'rw', state: 'Ok', elements: { DEW_A: { value: 0, min: 0, max: 100, step: 1 } } })
    fake.define({
      device: box,
      name: 'WEATHER_PARAMETERS',
      kind: 'number',
      perm: 'ro',
      state: 'Ok',
      elements: { WEATHER_TEMPERATURE: { value: 11.5, min: -50, max: 70 }, WEATHER_HUMIDITY: { value: 80, max: 100 }, WEATHER_DEWPOINT: { value: 8.1, min: -50, max: 70 } },
    })

    const power = await startCria(
      fake.port,
      [
        { id: 'weather', kind: 'weather', indiDevice: box },
        {
          id: 'switch',
          kind: 'switch',
          indiDevice: box,
          channels: [
            { name: '12V', property: 'POWER_CHANNELS', element: 'POWER_CHANNEL_1' },
            { name: 'Dew A', property: 'DEW_PWM', element: 'DEW_A' },
          ],
        },
      ],
      { acknowledgeMs: 600 },
    )

    try {
      const state = await power.waitFor(allReady(['weather', 'switch']))
      const [weather, powerBox] = state.devices

      expect(weather!.failureDomain).toBe(powerBox!.failureDomain)
      expect(weather!.readings.dewPointC).toMatchObject({ status: 'fresh', value: 8.1 })
      expect(powerBox!.channels[0]).toMatchObject({ name: { value: '12V' }, on: { value: true }, writable: { value: true } })

      expect(await power.run('switch', 'switch-set', { channelId: 0, value: 0 })).toMatchObject({ kind: 'confirmed', values: { value: 0 } })
      expect(fake.vector(box, 'POWER_CHANNELS').elements.POWER_CHANNEL_1!.value).toBe(false)

      const sentBefore = fake.received.filter(xml => xml.includes('DEW_PWM') && xml.startsWith('<new')).length

      expect(await power.run('switch', 'switch-set', { channelId: 1, value: 12.5 })).toMatchObject({ kind: 'failed' })
      expect(fake.received.filter(xml => xml.includes('DEW_PWM') && xml.startsWith('<new')).length).toBe(sentBefore)
      expect(await power.run('switch', 'switch-set', { channelId: 1, value: 40 })).toMatchObject({ kind: 'confirmed' })
    } finally {
      await power.stop()
    }
  })
})

describe('start-up connect (review R1-#11)', () => {
  it('runs as an operation on the device Run, visible to Vela', async () => {
    const box = 'Cold PPB'

    fake.define(connection(box, false))
    const late = await startCria(fake.port, [{ id: 'weather', kind: 'weather', indiDevice: box, connect: true }])

    try {
      const state = await late.waitFor(current => current.operations.some(operation => operation.state === 'settled' && operation.outcome.kind === 'confirmed'))
      const operation = state.operations[0] as unknown as { kind: string; requestId: string; deviceId: string }

      expect(operation).toMatchObject({ kind: 'device-connect', deviceId: 'weather' })
      expect(operation.requestId).toMatch(/^startup-/)
      expect(fake.vector(box, 'CONNECTION').elements.CONNECT!.value).toBe(true)
    } finally {
      await late.stop()
    }
  })
})
