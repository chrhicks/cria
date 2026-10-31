import type { Operation, OperationRequest } from '@cria/wire'
import { FakeIndi, type Behaviour, addCamera, addMount, connection } from '@cria/fake-indi'
import { am5, exposeNormally, moveMount } from '../../apps/cria/test/drivers.js'
import { allReady, startCria, valueOf, type Cria, type DeviceSpec } from '../../apps/cria/test/harness.js'
import { makeCriaClient, type CriaClient, type Reply } from '../cria-client.js'
import { failedStep, recordingFetch, type Recorded } from './golden.js'

const camera = 'Fake CCD'
const mount = 'ZWO AM5'
const focuser = 'Fake Focuser'
const box = 'Fake PPB'
const sidereal = 15.041067 / 3600
const slew = { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' }
const site = { latitudeDegrees: 40.0, longitudeDegrees: -75, elevationMeters: 0 }

type Kind = DeviceSpec['kind']

const fixedSiderealTime = { device: mount, name: 'TIME_LST', kind: 'number', perm: 'ro', state: 'Ok', elements: { LST: { value: 6.5, max: 24 } } } as const

const specs: Record<Kind, DeviceSpec> = {
  camera: { id: 'camera', kind: 'camera', indiDevice: camera },
  mount: { id: 'mount', kind: 'mount', indiDevice: mount },
  focuser: { id: 'focuser', kind: 'focuser', indiDevice: focuser },
  weather: { id: 'weather', kind: 'weather', indiDevice: box },
  switch: {
    id: 'switch',
    kind: 'switch',
    indiDevice: box,
    channels: [
      { name: '12V', property: 'POWER_CHANNELS', element: 'POWER_CHANNEL_1' },
      { name: 'Dew A', property: 'DEW_PWM', element: 'DEW_A', automaticWhileOn: 'Auto dew' },
      { name: 'Auto dew', property: 'AUTO_DEW_CONTROL', element: 'DEW_CHANNEL_1' },
    ],
  },
}

interface Identity {
  readonly requestId?: string
  readonly instanceId?: string
  readonly bindingId?: string
  readonly expectedName?: string
}

export interface Golden {
  readonly fake: FakeIndi
  readonly cria: Cria
  readonly wire: CriaClient
  readonly behave: (device: string, behaviour: Behaviour) => void
  readonly submit: (deviceId: string, kind: string, parameters: object, identity?: Identity) => Promise<Reply<Operation>>
  readonly recordSettled: (operationId: string) => Promise<Operation>
  readonly until: (what: string, holds: () => Promise<boolean>, timeoutMs?: number) => Promise<void>
  readonly recordFirstEvent: () => Promise<void>
}

export interface Scenario {
  readonly name: string
  readonly devices: ReadonlyArray<Kind>
  readonly config?: object
  /** Changes the fake before Cria starts, so device setup meets it. */
  readonly fake?: (fake: FakeIndi, behave: Golden['behave']) => void
  readonly run: (g: Golden) => Promise<void>
}

export async function runScenario(scenario: Scenario): Promise<Recorded[]> {
  const fake = new FakeIndi()
  const behaviours = new Map<string, Behaviour>()

  await fake.start()
  fake.behaviour = (fake, vector, values) => behaviours.get(vector.device)?.(fake, vector, values) ?? 'default'
  for (const kind of scenario.devices) define(fake, kind, behaviours)
  scenario.fake?.(fake, (device, behaviour) => behaviours.set(device, behaviour))

  const cria = await startCria(fake.port, scenario.devices.map(kind => specs[kind]), { acknowledgeMs: 600, ...scenario.config })
  const recorded: Recorded[] = []
  const client = makeCriaClient(cria.base, recordingFetch(recorded))

  const until = async (what: string, holds: () => Promise<boolean>, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs

    while (!(await holds())) {
      if (Date.now() > deadline) throw new Error(`${scenario.name}: timed out after ${timeoutMs} ms waiting for ${what}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }

  const g: Golden = {
    fake,
    cria,
    wire: client,
    behave: (device, behaviour) => behaviours.set(device, behaviour),
    async submit(deviceId, kind, parameters, identity = {}) {
      const state = await cria.state()
      const target = state.devices.find(device => device.id === deviceId)

      return client.submit({
        instanceId: identity.instanceId ?? state.instanceId,
        requestId: identity.requestId ?? crypto.randomUUID(),
        deviceId,
        bindingId: identity.bindingId ?? target?.bindingId ?? crypto.randomUUID(),
        expectedName: identity.expectedName ?? target?.name ?? deviceId,
        kind,
        parameters,
      } as unknown as OperationRequest)
    },
    async recordSettled(operationId) {
      const { operation } = await cria.settled(operationId)

      await until(`${operation.deviceId} at rest after ${operation.kind}`, async () => {
        const availability = (await cria.device(operation.deviceId)).availability

        return availability.ready || !['busy', 'refreshing'].includes(availability.reason)
      })
      const reply = await client.operation(operationId)

      if (!reply.ok) throw new Error(`${scenario.name}: ${operationId} vanished: ${reply.body.error.code}`)

      return reply.body
    },
    until,
    async recordFirstEvent() {
      const state = await client.firstEvent()

      recorded.at(-1)!.body = state
    },
  }

  try {
    await cria.waitFor(state =>
      state.devices.every(device => device.availability.ready || (device.availability.reason === 'commands-disabled' && device.readings.connected.status === 'fresh')),
    )
    await scenario.run(g)
  } catch (error) {
    recorded.push({ request: failedStep, status: 0, body: error instanceof Error ? error.message : String(error) })
  } finally {
    await cria.stop()
    await fake.stop()
  }

  return recorded
}

function define(fake: FakeIndi, kind: Kind, behaviours: Map<string, Behaviour>) {
  switch (kind) {
    case 'camera': {
      const expose = exposeNormally()

      addCamera(fake, camera)
      fake.define({ device: camera, name: 'CCD_TEMPERATURE', kind: 'number', perm: 'rw', state: 'Idle', elements: { CCD_TEMPERATURE_VALUE: { value: 20, min: -50, max: 50 } } })
      behaviours.set(camera, (fake, vector, values) => {
        if (vector.name !== 'CCD_TEMPERATURE') return expose(fake, vector, values)
        fake.update(camera, vector.name, { state: 'Busy' })

        return 'handled'
      })

      return
    }
    case 'mount':
      addMount(fake, mount)
      fake.define(fixedSiderealTime)
      behaviours.set(mount, moveMount({ finishAfterMs: 100 }))

      return
    case 'focuser':
      fake.define(connection(focuser))
      fake.define({ device: focuser, name: 'ABS_FOCUS_POSITION', kind: 'number', perm: 'rw', state: 'Ok', elements: { FOCUS_ABSOLUTE_POSITION: { value: 1000, max: 50_000, step: 1 } } })
      fake.define({ device: focuser, name: 'FOCUS_ABORT_MOTION', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })
      behaviours.set(focuser, moveFocuser(100))

      return
    case 'weather':
    case 'switch':
      if (fake.vectors.has(`${box}.CONNECTION`)) return
      fake.define(connection(box))
      fake.define({ device: box, name: 'POWER_CHANNELS', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { POWER_CHANNEL_1: { value: true } } })
      fake.define({ device: box, name: 'DEW_PWM', kind: 'number', perm: 'rw', state: 'Ok', elements: { DEW_A: { value: 0, max: 100, step: 1 } } })
      fake.define({ device: box, name: 'AUTO_DEW_CONTROL', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { DEW_CHANNEL_1: { value: false } } })
      fake.define({
        device: box,
        name: 'WEATHER_PARAMETERS',
        kind: 'number',
        perm: 'ro',
        state: 'Ok',
        elements: { WEATHER_TEMPERATURE: { value: 11.5, min: -50, max: 70 }, WEATHER_HUMIDITY: { value: 80, max: 100 }, WEATHER_DEWPOINT: { value: 8.1, min: -50, max: 70 } },
      })
  }
}

const temperatureProperty = 'FOCUS_TEMPERATURE'

function focuserTemperature(celsius: number) {
  return { device: focuser, name: temperatureProperty, kind: 'number', perm: 'ro', state: 'Ok', elements: { TEMPERATURE: { value: celsius, min: -50, max: 70 } } } as const
}

function moveFocuser(finishAfterMs: number | 'never'): Behaviour {
  return (fake, vector, values) => {
    const position = fake.vector(vector.device, 'ABS_FOCUS_POSITION')

    if (vector.name === 'FOCUS_ABORT_MOTION') {
      if (position.state === 'Busy') fake.update(vector.device, position.name, { state: 'Idle' })
      fake.update(vector.device, vector.name, { state: 'Ok' })

      return 'handled'
    }

    if (vector.name !== position.name) return 'default'
    fake.update(vector.device, position.name, { state: 'Busy' })
    if (finishAfterMs !== 'never')
      setTimeout(() => {
        if (position.state !== 'Busy') return
        fake.apply(position, values)
        fake.update(vector.device, position.name, { state: 'Ok' })
      }, finishAfterMs).unref()

    return 'handled'
  }
}

function abortWithoutStopping(): Behaviour {
  const move = moveMount()

  return (fake, vector, values) => {
    if (vector.name !== 'TELESCOPE_ABORT_MOTION') return move(fake, vector, values)
    fake.update(vector.device, vector.name, { state: 'Ok' })

    return 'handled'
  }
}

const abortsSent = (g: Golden) => g.fake.received.filter(xml => xml.includes('name="TELESCOPE_ABORT_MOTION"')).length

const axisTurnHours = 0.1
const axisTurnAfterMs = 50

function turnAxis(): Behaviour {
  const move = moveMount()

  return (fake, vector, values) => {
    if (vector.name === 'TELESCOPE_MOTION_WE' && Object.values(values).includes('On'))
      setTimeout(() => {
        const ra = fake.vector(mount, 'EQUATORIAL_EOD_COORD').elements.RA!.value as number

        fake.update(mount, 'EQUATORIAL_EOD_COORD', { values: { RA: ra + axisTurnHours } })
      }, axisTurnAfterMs).unref()

    return move(fake, vector, values)
  }
}

async function untilUnderWay(g: Golden, operation: Operation) {
  await g.until(`${operation.kind} under way`, async () => {
    const device = await g.cria.device(operation.deviceId)
    const current = await g.cria.client.operation(operation.id)
    const moving = valueOf(device, device.kind === 'camera' ? 'activity' : device.kind === 'mount' ? 'slewing' : 'moving')

    return current.ok && current.body.state === 'running' && (moving === true || moving === 'exposing') && (device.kind !== 'camera' || current.body.progress.phase !== 'preparing')
  })

  return operation
}

async function submitted(reply: Promise<Reply<Operation>>) {
  const settled = await reply

  if (!settled.ok) throw new Error(`refused ${settled.status} ${settled.body.error.code}`)

  return settled.body
}

async function runAndSettle(g: Golden, deviceId: string, kind: string, parameters: object) {
  return g.recordSettled((await submitted(g.submit(deviceId, kind, parameters))).id)
}

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: 'health',
    devices: ['camera'],
    run: async g => {
      await g.wire.health()
    },
  },
  {
    name: 'state at rest, every device kind',
    devices: ['camera', 'mount', 'focuser', 'weather', 'switch'],
    run: async g => {
      await g.wire.state()
    },
  },
  {
    name: 'first SSE state event',
    devices: ['camera', 'mount', 'focuser', 'weather', 'switch'],
    run: async g => {
      await g.recordFirstEvent()
    },
  },
  {
    name: 'capture, then download the original',
    devices: ['camera'],
    run: async g => {
      const operation = await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 0.1, light: true })

      await g.wire.download(operation)
    },
  },
  {
    name: 'capture a flat and a bias, with their frame types',
    devices: ['camera'],
    run: async g => {
      await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 0.1, light: true, frameType: 'flat' })
      await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 0.1, light: false, frameType: 'bias' })
    },
  },
  {
    name: 'camera-configure',
    devices: ['camera'],
    run: async g => {
      await runAndSettle(g, 'camera', 'camera-configure', { binX: 2, binY: 2, width: 4, height: 3 })
    },
  },
  {
    name: 'camera-configure, binning only: the applied frame in binned pixels',
    devices: ['camera'],
    run: async g => {
      await runAndSettle(g, 'camera', 'camera-configure', { binX: 2, binY: 2 })
    },
  },
  {
    name: 'camera-configure refused: a width off the frame grid',
    devices: ['camera'],
    config: { devices: [{ ...specs.camera, frameGrid: { width: 4 } }] },
    run: async g => {
      await runAndSettle(g, 'camera', 'camera-configure', { width: 3 })
    },
  },
  {
    name: 'cooling, then the commanded setpoint in state',
    devices: ['camera'],
    run: async g => {
      await runAndSettle(g, 'camera', 'cooling', { setpointC: -10 })
      await g.wire.state()
    },
  },
  {
    name: 'focuser-move',
    devices: ['focuser'],
    run: async g => {
      await runAndSettle(g, 'focuser', 'focuser-move', { position: 1500, minPosition: 1, maxPosition: 40_000 })
    },
  },
  {
    name: 'focuser-halt, idle focuser',
    devices: ['focuser'],
    run: async g => {
      await runAndSettle(g, 'focuser', 'focuser-halt', {})
    },
  },
  {
    name: 'focuser-halt pre-empts a running move',
    devices: ['focuser'],
    run: async g => {
      g.behave(focuser, moveFocuser('never'))
      const move = await untilUnderWay(g, await submitted(g.submit('focuser', 'focuser-move', { position: 1500, minPosition: 1, maxPosition: 40_000 })))
      const halt = await submitted(g.submit('focuser', 'focuser-halt', {}))

      await g.recordSettled(halt.id)
      await g.recordSettled(move.id)
    },
  },
  {
    name: 'mount-slew',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-slew', slew)
    },
  },
  {
    name: 'mount-tracking',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-tracking', { tracking: true })
    },
  },
  {
    name: 'mount-axis',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-axis', { rateDegreesPerSecond: 2 * sidereal, durationSeconds: 0.2 })
    },
  },
  {
    name: 'mount-axis at a rate the mount does not offer: failed before moving',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-axis', { rateDegreesPerSecond: 0.05, durationSeconds: 0.2 })
    },
  },
  {
    name: 'mount-rotate',
    devices: ['mount'],
    run: async g => {
      g.behave(mount, turnAxis())
      await runAndSettle(g, 'mount', 'mount-rotate', { rateDegreesPerSecond: 60 * sidereal, distanceDegrees: 1 })
    },
  },
  {
    name: 'mount-rotate refused: the stop lead is more than half the distance',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-rotate', { rateDegreesPerSecond: 1440 * sidereal, distanceDegrees: 1 })
    },
  },
  {
    name: 'mount-home',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-home', {})
    },
  },
  {
    name: 'mount-park, then mount-unpark',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-park', {})
      await runAndSettle(g, 'mount', 'mount-unpark', {})
    },
  },
  {
    name: 'mount-stop, repeated',
    devices: ['mount'],
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-stop', {})
      await runAndSettle(g, 'mount', 'mount-stop', {})
    },
  },
  {
    name: 'mount-stop pre-empts a running slew',
    devices: ['mount'],
    run: async g => {
      g.behave(mount, moveMount())
      const moving = await untilUnderWay(g, await submitted(g.submit('mount', 'mount-slew', slew)))
      const stop = await submitted(g.submit('mount', 'mount-stop', {}))

      await g.recordSettled(stop.id)
      await g.recordSettled(moving.id)
    },
  },
  {
    name: 'mount-slew on an AM5 without a configured site: refused, naming what the mount needs and what Cria sent',
    devices: ['mount'],
    fake: (fake, behave) => behave(mount, am5(fake, mount).behaviour),
    run: async g => {
      await runAndSettle(g, 'mount', 'mount-slew', slew)
    },
  },
  {
    name: 'mount-slew on an AM5 set up at start: the site, then the time, then the goto',
    devices: ['mount'],
    config: { devices: [{ ...specs.mount, site }] },
    fake: (fake, behave) => behave(mount, am5(fake, mount, { slewDegreesPerSecond: 60, publishEveryMs: 100 }).behaviour),
    run: async g => {
      const setup = (await g.cria.state()).operations.find(operation => operation.kind === 'device-connect')

      await g.wire.operation(setup?.id ?? 'no start-up setup')
      await runAndSettle(g, 'mount', 'mount-slew', slew)
    },
  },
  {
    name: 'mount-stop on an AM5 that coasts after the abort: confirmed once the mount stands still',
    devices: ['mount'],
    fake: (fake, behave) => behave(mount, am5(fake, mount, { requireSiteAndTime: false }).behaviour),
    run: async g => {
      const moving = await untilUnderWay(g, await submitted(g.submit('mount', 'mount-slew', slew)))
      const stop = await submitted(g.submit('mount', 'mount-stop', {}))

      await g.recordSettled(stop.id)
      await g.recordSettled(moving.id)
    },
  },
  {
    name: 'two mount-stops queued behind a running slew both run',
    devices: ['mount'],
    run: async g => {
      g.behave(mount, abortWithoutStopping())
      const moving = await untilUnderWay(g, await submitted(g.submit('mount', 'mount-slew', slew)))
      const first = await submitted(g.submit('mount', 'mount-stop', {}))
      const second = await submitted(g.submit('mount', 'mount-stop', {}))

      await g.until('the slew asked to stop', async () => abortsSent(g) === 1)
      g.fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Alert' })
      await g.recordSettled(moving.id)
      await g.recordSettled(first.id)
      await g.recordSettled(second.id)
    },
  },
  {
    name: 'recover refused while a mount-stop runs',
    devices: ['mount'],
    run: async g => {
      g.behave(mount, abortWithoutStopping())
      g.fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Busy' })
      const stop = await submitted(g.submit('mount', 'mount-stop', {}))

      await g.until('the stop sending its abort', async () => abortsSent(g) === 1)
      const state = await g.cria.state()
      const recovery = { instanceId: state.instanceId, bindingId: state.devices[0]!.bindingId, externalRecoveryConfirmed: true, note: 'checked' }

      await g.wire.recover('mount', recovery)
      g.fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Alert' })
      await g.recordSettled(stop.id)
      await g.wire.recover('mount', recovery)
    },
  },
  {
    name: 'switch-set',
    devices: ['switch'],
    run: async g => {
      await runAndSettle(g, 'switch', 'switch-set', { channelId: 0, value: 0 })
      await runAndSettle(g, 'switch', 'switch-set', { channelId: 1, value: 40 })
    },
  },
  {
    name: 'switch-set refused: a dew duty while auto dew is on',
    devices: ['switch'],
    run: async g => {
      g.fake.update(box, 'AUTO_DEW_CONTROL', { state: 'Ok', values: { DEW_CHANNEL_1: true } })
      await g.until('Cria to see auto dew on', async () => {
        const power = await g.cria.device('switch')

        return power.kind === 'switch' && power.channels[2]!.on.status === 'fresh' && power.channels[2]!.on.value
      })
      await runAndSettle(g, 'switch', 'switch-set', { channelId: 1, value: 40 })
    },
  },
  {
    name: 'device-connect, off then on',
    devices: ['weather'],
    run: async g => {
      await runAndSettle(g, 'weather', 'device-connect', { connected: false })
      await runAndSettle(g, 'weather', 'device-connect', { connected: true })
    },
  },
  {
    name: 'cancel a running capture, then cancel it again',
    devices: ['camera'],
    run: async g => {
      const capture = await untilUnderWay(g, await submitted(g.submit('camera', 'capture', { exposureSeconds: 60, light: true })))

      await g.wire.cancel(capture.id)
      await g.recordSettled(capture.id)
      await g.wire.cancel(capture.id)
    },
  },
  {
    name: 'refused: device busy',
    devices: ['camera'],
    run: async g => {
      const capture = await untilUnderWay(g, await submitted(g.submit('camera', 'capture', { exposureSeconds: 60, light: true })))

      await g.submit('camera', 'camera-configure', { binX: 2 })
      await g.cria.cancel(capture.id)
      await g.cria.settled(capture.id)
    },
  },
  {
    name: 'refused: wrong device kind',
    devices: ['mount'],
    run: async g => {
      await g.submit('mount', 'capture', { exposureSeconds: 1, light: true })
    },
  },
  {
    name: 'refused: commands disabled',
    devices: ['camera'],
    config: { commandsEnabled: false },
    run: async g => {
      await g.wire.state()
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: true })
    },
  },
  {
    name: 'refused: instance changed',
    devices: ['camera'],
    run: async g => {
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: true }, { instanceId: crypto.randomUUID() })
    },
  },
  {
    name: 'refused: binding changed',
    devices: ['camera'],
    run: async g => {
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: true }, { bindingId: crypto.randomUUID() })
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: true }, { expectedName: 'Another CCD' })
    },
  },
  {
    name: 'refused: invalid request',
    devices: ['camera'],
    run: async g => {
      await g.submit('camera', 'capture', { exposureSeconds: 0, light: true })
      await g.submit('camera', 'capture', { exposureSeconds: 1 })
      await g.submit('camera', 'teleport', {})
      await g.submit('nowhere', 'capture', { exposureSeconds: 1, light: true })
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: true, padding: 'x'.repeat(17 * 1024) })
    },
  },
  {
    name: 'refused: capture frame type that disagrees with light, or is not one',
    devices: ['camera'],
    run: async g => {
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: true, frameType: 'bias' })
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: false, frameType: 'flat' })
      await g.submit('camera', 'capture', { exposureSeconds: 1, light: false, frameType: 'dark-flat' })
    },
  },
  {
    name: 'refused: unknown operation, request and device',
    devices: ['camera'],
    run: async g => {
      const state = await g.cria.state()

      await g.wire.operation(crypto.randomUUID())
      await g.wire.cancel(crypto.randomUUID())
      await g.wire.byRequest(state.instanceId, 'never-sent')
      await g.wire.recover('nowhere', { instanceId: state.instanceId, bindingId: crypto.randomUUID(), externalRecoveryConfirmed: true, note: 'checked' })
    },
  },
  {
    name: 'duplicate request ID: same content returns the operation, changed content is refused',
    devices: ['camera'],
    run: async g => {
      const requestId = crypto.randomUUID()
      const first = await submitted(g.submit('camera', 'camera-configure', { binX: 2, binY: 2, width: 4, height: 3 }, { requestId }))

      await g.recordSettled(first.id)
      await g.submit('camera', 'camera-configure', { binX: 2, binY: 2, width: 4, height: 3 }, { requestId })
      await g.submit('camera', 'camera-configure', { binX: 1, binY: 1, width: 4, height: 3 }, { requestId })
      await g.wire.byRequest(first.instanceId, requestId)
    },
  },
  {
    name: 'refused: result expired',
    devices: ['switch'],
    config: { operationHistory: 10 },
    run: async g => {
      const requestId = crypto.randomUUID()
      const first = await submitted(g.submit('switch', 'switch-set', { channelId: 1, value: 1 }, { requestId }))

      await g.recordSettled(first.id)
      for (let value = 2; value <= 11; value++) await g.cria.run('switch', 'switch-set', { channelId: 1, value })
      await g.wire.operation(first.id)
      await g.submit('switch', 'switch-set', { channelId: 1, value: 1 }, { requestId })
      await g.wire.byRequest(first.instanceId, requestId)
    },
  },
  {
    name: 'refused: image gone',
    devices: ['camera'],
    config: { imageBudgetBytes: 1 },
    run: async g => {
      const evicted = await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 0.05, light: true })
      const kept = await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 0.05, light: false })

      await g.wire.download(evicted)
      await g.wire.download(kept)
      await g.wire.refusedOriginal('not-an-image-id')
    },
  },
  {
    name: 'no acknowledgement: uncertain, the camera is not held, the next capture runs, a recovery is still accepted',
    devices: ['camera'],
    run: async g => {
      const normal = exposeNormally()

      g.behave(camera, (fake, vector, values) => (vector.name === 'CCD_EXPOSURE' ? 'handled' : normal(fake, vector, values)))
      const lost = await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 1, light: true })

      await g.wire.state()
      g.fake.update(camera, 'CCD_EXPOSURE', { state: 'Idle' })
      g.behave(camera, normal)
      await g.cria.waitFor(allReady(['camera']))
      await runAndSettle(g, 'camera', 'capture', { exposureSeconds: 0.05, light: true })
      const state = await g.cria.state()
      const idle = state.devices[0]!

      await g.wire.recover('camera', { instanceId: state.instanceId, bindingId: crypto.randomUUID(), externalRecoveryConfirmed: true, note: 'checked' })
      await g.wire.recover('camera', { instanceId: crypto.randomUUID(), bindingId: idle.bindingId, externalRecoveryConfirmed: true, note: 'checked' })
      await g.wire.recover('camera', { instanceId: state.instanceId, bindingId: idle.bindingId, externalRecoveryConfirmed: false, note: 'checked' })
      await g.wire.recover('camera', { instanceId: state.instanceId, bindingId: idle.bindingId, externalRecoveryConfirmed: true, note: 'Chris checked the camera: idle' })
      await g.wire.operation(lost.id)
    },
  },
  {
    name: 'skipped bad update: the focuser temperature reads unavailable until a good definition comes back',
    devices: ['camera', 'focuser'],
    fake: fake => fake.define(focuserTemperature(12.5)),
    run: async g => {
      const temperatureIs = (status: string) => async () => {
        const state = await g.cria.state()
        const readings = state.devices.find(device => device.id === 'focuser')!.readings

        return readings.temperatureC?.status === status
      }
      const asked = () => g.fake.received.filter(xml => xml.startsWith('<getProperties') && xml.includes(`name="${temperatureProperty}"`)).length

      await g.wire.state()
      // The fake stops answering for a moment, so Cria's request for the property stays unanswered while the state is recorded.
      g.fake.answering = false
      g.fake.raw(
        `<setNumberVector device="${focuser}" name="${temperatureProperty}" state="Ok"><oneNumber name="TEMPERATURE">12abc</oneNumber></setNumberVector>\n`,
        focuser,
        temperatureProperty,
      )
      await g.until('the focuser temperature to read unavailable', temperatureIs('unavailable'))
      await g.until('Cria to ask the driver for the property', async () => asked() === 1)
      await g.wire.state()
      g.fake.answering = true
      g.fake.define(focuserTemperature(13.5))
      await g.until('the focuser temperature to read again', temperatureIs('fresh'))
      await g.wire.state()
    },
  },
]
