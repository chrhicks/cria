/**
 * Scenarios a simulator can't produce on demand, against a fake INDI server:
 * drivers that never answer, refuse, ignore an abort, vanish, or lose the
 * connection, plus a Pegasus-like power box. Each one checks what Vela is
 * told.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera, connection, type Behaviour } from '@cria/fake-indi'
import { fitsFrame } from '@cria/fits'
import { exposeNormally } from './drivers.js'
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
  it("converts the FITS frame to column-major ImageBytes with the camera's colour pattern", async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })

    expect(operation).toMatchObject({ kind: 'confirmed', image: { width: 8, height: 6, color: 'grbg' } })
    const bytes = Buffer.from(await (await fetch(cria.base + operation.image!.original.url)).arrayBuffer())
    const pixel = (x: number, y: number) => bytes.readUInt16LE(44 + (x * 6 + y) * 2)

    expect([pixel(0, 0), pixel(3, 0), pixel(0, 2), pixel(7, 5)]).toEqual([0, 3, 20, 57])
  })

  it('never answers an exposure: uncertain, and sent once', async () => {
    fake.behaviour = (_fake, vector) => (vector.name === 'CCD_EXPOSURE' ? 'handled' : 'default')
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(operation).toMatchObject({ kind: 'uncertain' })
    expect(exposures()).toBe(1)

    fake.update(camera, 'CCD_EXPOSURE', { state: 'Idle' })
    fake.behaviour = exposeNormally()
    await cria.waitFor(allReady(['primary']))
    expect((await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })).kind).toBe('confirmed')
    expect(exposures()).toBe(2)
  })

  it('refuses an exposure with Alert: failed', async () => {
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_EXPOSURE') return 'default'
      fake.update(camera, 'CCD_EXPOSURE', { state: 'Alert', message: 'exposure out of range' })

      return 'handled'
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled' })
    expect(operation.message).toMatch(/exposure out of range/)
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

    expect(operation).toMatchObject({ kind: 'uncertain' })
    expect(operation.message).toMatch(/stop was not confirmed/)
  }, 40_000)

  it('vanishes mid-exposure (driver crashed): uncertain, readings unavailable', async () => {
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_EXPOSURE') return 'default'
      fake.update(camera, 'CCD_EXPOSURE', { state: 'Busy' })
      setTimeout(() => fake.removeDevice(camera), 200)

      return 'handled'
    }
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 5, light: true })

    expect(operation).toMatchObject({ kind: 'uncertain' })
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

    expect(operation).toMatchObject({ kind: 'uncertain' })
    expect(operation.message).toMatch(/connection lost/)

    await cria.waitFor(state => state.devices[0]!.readings.connected!.status === 'fresh')

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
    expect(operation).toMatchObject({ kind: 'uncertain', reason: 'connection-lost', message: 'indiserver connection lost during the exposure' })
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

    expect(operation).toMatchObject({ kind: 'uncertain' })
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

  const withGain = async () => {
    fake.define({ device: camera, name: 'CCD_CONTROLS', kind: 'number', perm: 'rw', state: 'Ok', elements: { Gain: { value: 100, min: 0, max: 700, step: 1 } } })
    await cria.waitFor(noneNotRead)
  }

  it('#10: waits for the driver to echo a number setting', async () => {
    await withGain()
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'CCD_CONTROLS') return 'default'
      fake.update(camera, 'CCD_CONTROLS', { state: 'Ok' })
      setTimeout(() => {
        fake.apply(vector, values)
        fake.update(camera, 'CCD_CONTROLS', { state: 'Ok' })
      }, 1500)

      return 'handled'
    }

    expect(await cria.run('primary', 'camera-configure', { gain: 200 })).toMatchObject({ kind: 'confirmed' })
  })

  it('#10: old values at the deadline are uncertain, not "rejected"', async () => {
    await withGain()
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'CCD_CONTROLS') return 'default'
      fake.update(camera, 'CCD_CONTROLS', { state: 'Ok' })

      return 'handled'
    }

    expect(await cria.run('primary', 'camera-configure', { gain: 200 })).toMatchObject({ kind: 'uncertain' })
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

  describe('when only frames that are not its own arrive', () => {
    const mismatched = (afterFrame: (fake: FakeIndi) => void): Behaviour => (fake, vector, values) => {
      if (vector.name !== 'CCD_EXPOSURE') return exposeNormally()(fake, vector, values)
      fake.update(camera, vector.name, { state: 'Busy' })
      setTimeout(() => {
        fake.sendBlob(camera, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: 7 }))
        afterFrame(fake)
      }, 100)

      return 'handled'
    }

    const strictCria = () => startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600 })

    it('keeps waiting until the client cancels, and takes the next capture', async () => {
      const strict = await strictCria()

      try {
        await strict.waitFor(allReady(['primary']))
        fake.behaviour = mismatched(fake => fake.update(camera, 'CCD_EXPOSURE', { state: 'Ok', values: { CCD_EXPOSURE_VALUE: 0 } }))
        const submitted = await strict.submit('primary', 'capture', { exposureSeconds: 0.2, light: true })

        await new Promise(resolve => setTimeout(resolve, 500))
        expect((await strict.state()).operations.find(operation => operation.id === submitted.body.id)?.state).not.toBe('settled')
        await strict.cancel(submitted.body.id)
        expect((await strict.settled(submitted.body.id)).kind).toBe('stopped')

        fake.behaviour = exposeNormally()
        expect(await strict.run('primary', 'capture', { exposureSeconds: 0.2, light: true })).toMatchObject({ kind: 'confirmed' })
      } finally {
        await strict.stop()
      }
    })
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
      expect(operation).toMatchObject({ kind: 'confirmed', state: 'settled' })
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
