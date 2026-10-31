/**
 * The failure cases as scenarios on a whole fake errai rig (both cameras, the EAF, the AM5 and the
 * Pegasus power box), for two users: `scenarios.test.ts`, which runs each one against the real Cria
 * and asserts the outcome, and `testing/fake-rig.ts` (`pnpm fake-rig serve <scenario>`), which serves
 * the same rig and the same real Cria for a person with a test Vela (docs/testing.md, "Serving a case
 * to a test Vela"). The fake drivers are the ones in drivers.ts; a scenario only chooses which fault
 * the rig has. `source` says whether the case is the drivers' words from a recording or was derived
 * (the recordings hold no real failure of that kind).
 */
import { FakeIndi, addCamera, addMount, connection, type Behaviour } from '@cria/fake-indi'
import { addDewHeaters, addEaf, am5, appliesNothing, exposeNormally, guideLoop, type Am5Options, type FakeAm5 } from './drivers.js'
import { startCria, until, type Cria, type DeviceSpec, type Ending } from './harness.js'

export const names = {
  primary: 'ZWO CCD ASI2600MC Pro',
  guide: 'ZWO CCD ASI220MM Mini',
  focuser: 'ZWO EAF',
  mount: 'ZWO AM5',
  box: 'Pegasus PPBA',
}

export interface Rig {
  readonly fake: FakeIndi
  readonly mount: FakeAm5
  readonly cria: Cria
}

export interface Scenario {
  readonly name: string
  readonly source: 'recorded' | 'derived'
  /** The night, device and exchange the case comes from, or what it was derived from. */
  readonly episode: string
  /** What to do in Vela. */
  readonly tryThis: string
  /** What Vela should then show. */
  readonly expect: string
  /** What the scenario's own driver does to the command, for `fake-rig list` and the test. */
  readonly outcome: { readonly device: string; readonly kind: Ending['kind']; readonly reason: string | null; readonly held: boolean; readonly message?: string }
  readonly mountOptions?: Am5Options
  /** The mount's declination before the first command (default 40). */
  readonly declination?: number
  readonly eaf?: { readonly stopsShortBy: number }
  /** The power box starts disconnected. */
  readonly boxDisconnected?: boolean
  readonly config?: object
  /** Wraps the rig's behaviour with the scenario's fault. */
  readonly wrap?: (next: Behaviour, rig: { readonly fake: FakeIndi; readonly mount: () => FakeAm5 }) => Behaviour
  /** Anything that runs beside the rig (another client's loop). */
  readonly alongside?: (fake: FakeIndi) => void
  /** The commands the test sends to meet the case; a person sends them from Vela. */
  readonly drive: (rig: Rig) => Promise<Ending>
}

const site = { latitudeDegrees: 40.0, longitudeDegrees: -75, elevationMeters: 0 }
const channels = [
  { name: '12V ports', property: 'POWER_CHANNELS', element: 'POWER_CHANNEL_1' },
  { name: 'Dew A', property: 'DEW_CHANNELS', element: 'DEW_CHANNEL_1' },
  { name: 'Dew B', property: 'DEW_CHANNELS', element: 'DEW_CHANNEL_2' },
  { name: 'Dew A duty (%)', property: 'DEW_DUTY_CYCLES', element: 'DEW_CHANNEL_1', automaticWhileOn: 'Auto dew' },
  { name: 'Dew B duty (%)', property: 'DEW_DUTY_CYCLES', element: 'DEW_CHANNEL_2', automaticWhileOn: 'Auto dew' },
  { name: 'Auto dew', property: 'AUTO_DEW_CONTROL', element: 'DEW_CHANNEL_1' },
]

const devices: ReadonlyArray<DeviceSpec> = [
  { id: 'primary', kind: 'camera', indiDevice: names.primary, frameGrid: { width: 8, height: 2 } },
  { id: 'guide', kind: 'camera', indiDevice: names.guide, frameGrid: { width: 8, height: 2 } },
  { id: 'focuser', kind: 'focuser', indiDevice: names.focuser, travel: { min: 15500, max: 38000 } },
  { id: 'mount', kind: 'mount', indiDevice: names.mount, site },
  { id: 'weather', kind: 'weather', indiDevice: names.box },
  { id: 'switch', kind: 'switch', indiDevice: names.box, channels },
]

const focusMove = { position: 31000, minPosition: 15500, maxPosition: 38000 }
const ignoring = (device: string, property: string, next: Behaviour): Behaviour => (fake, vector, values) =>
  vector.device === device && vector.name === property ? 'handled' : next(fake, vector, values)

async function homeThenStop({ cria, fake }: Rig): Promise<Ending> {
  const home = await cria.submit('mount', 'mount-home', {})

  await until('TELESCOPE_HOME to go Busy', () => fake.vector(names.mount, 'TELESCOPE_HOME').state === 'Busy', 10_000)
  // Recorded: the abort came 1.0 s into the home.
  await new Promise(resolve => setTimeout(resolve, 1000))
  await cria.cancel(home.body.id)

  return cria.settled(home.body.id, 60_000)
}

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: 'camera-silent',
    source: 'derived',
    episode: 'No recorded camera failure (1,462 exposures all answered). Derived: the driver never answers an exposure.',
    tryThis: 'Start a capture on the primary camera.',
    expect: 'The capture ends uncertain (no acknowledgement) and Vela shows the warning on the camera; the camera is not held and the next capture is accepted.',
    outcome: { device: 'primary', kind: 'uncertain', reason: 'no-acknowledgement', held: false },
    wrap: next => ignoring(names.primary, 'CCD_EXPOSURE', next),
    drive: ({ cria }) => cria.run('primary', 'capture', { exposureSeconds: 1, light: true }),
  },
  {
    name: 'focuser-short',
    source: 'derived',
    episode: 'No recorded focuser failure (63 moves all arrived). Derived: the move ends Ok 150 steps short of the target.',
    tryThis: 'Move the focuser to 31000 (or run an autofocus).',
    expect: 'The move ends uncertain (not confirmed: "stopped at 31150, short of 31000"), the focuser warning shows, the focuser is not held.',
    outcome: { device: 'focuser', kind: 'uncertain', reason: 'not-confirmed', held: false, message: 'Focuser stopped at 31150, short of 31000' },
    eaf: { stopsShortBy: 150 },
    drive: ({ cria }) => cria.run('focuser', 'focuser-move', focusMove),
  },
  {
    name: 'focuser-silent',
    source: 'derived',
    episode: 'No recorded focuser failure. Derived: the driver never answers a move.',
    tryThis: 'Move the focuser to 31000.',
    expect: 'The move ends uncertain (no acknowledgement) after Cria has sent an abort; the warning shows; the focuser is not held.',
    outcome: { device: 'focuser', kind: 'uncertain', reason: 'no-acknowledgement', held: false },
    wrap: next => ignoring(names.focuser, 'ABS_FOCUS_POSITION', next),
    drive: ({ cria }) => cria.run('focuser', 'focuser-move', focusMove),
  },
  {
    name: 'switch-ignored',
    source: 'derived',
    episode: 'No recorded switch failure. Derived: the box acknowledges the write and keeps the old value (the recorded relative is the Pegasus dew duty being set back to 0 under auto dew).',
    tryThis: 'Switch the 12 V ports off (switch channel 0).',
    expect: 'After 15 s the command ends uncertain (the driver still shows the old value), the switch warning shows, the switch is not held.',
    outcome: { device: 'switch', kind: 'uncertain', reason: 'not-confirmed', held: false },
    wrap: next => (fake, vector, values) => (vector.name === 'POWER_CHANNELS' ? appliesNothing('POWER_CHANNELS')(fake, vector, values) : next(fake, vector, values)),
    drive: ({ cria }) => cria.run('switch', 'switch-set', { channelId: 0, value: 0 }),
  },
  {
    name: 'weather-silent',
    source: 'derived',
    episode: 'No recorded weather failure; weather has no command but connect. Derived: the box never answers a connect.',
    tryThis: 'Connect the weather device.',
    expect: 'The connect ends uncertain (no acknowledgement; the wait is 8 s here, 120 s on errai), the weather warning shows, the device is not held.',
    outcome: { device: 'weather', kind: 'uncertain', reason: 'no-acknowledgement', held: false },
    boxDisconnected: true,
    config: { initializeTimeoutMs: 8000 },
    wrap: next => ignoring(names.box, 'CONNECTION', next),
    drive: ({ cria }) => cria.run('weather', 'device-connect', { connected: true }),
  },
  {
    name: 'guide-loop',
    source: 'recorded',
    episode: 'ZWO ASI220MM Mini, 2026-10-27: PHD2 looped 2 s exposures (1,027 frames) that Cria never asked for.',
    tryThis: 'Look at the guide camera while you capture on the primary camera.',
    expect: 'A frame arrives on the guide camera every 2.75 s without a command; Cria ignores them, the primary capture confirms with its own image, nothing is held and no warning shows.',
    outcome: { device: 'primary', kind: 'confirmed', reason: null, held: false },
    alongside: fake => void guideLoop(fake, names.guide),
    drive: ({ cria }) => cria.run('primary', 'capture', { exposureSeconds: 1, light: true }),
  },
  {
    name: 'mount-home-stop',
    source: 'recorded',
    episode: 'ZWO AM5, 2026-10-26 and 2026-10-27: a stop during Home; the driver acknowledges the abort and leaves TELESCOPE_HOME Busy.',
    tryThis: 'Send the mount Home, then stop it a second later.',
    expect: 'The home ends stopped once the mount stands still (about 2 s after the abort); the mount is not held.',
    outcome: { device: 'mount', kind: 'stopped', reason: null, held: false },
    drive: homeThenStop,
  },
  {
    name: 'mount-power-cut',
    source: 'recorded',
    episode: 'ZWO AM5, 2026-10-29 evening: power cut mid axis motion; serial errors every second, the stop answered Alert.',
    tryThis: 'Rotate the mount (mount-rotate, a few degrees at 9x). One second after the motion starts the fake mount loses power.',
    expect: 'The rotate ends uncertain (stop not confirmed) after the stop has been sent repeatedly (five times on the night), and the mount is held until you clear it.',
    outcome: { device: 'mount', kind: 'uncertain', reason: 'stop-not-confirmed', held: true },
    wrap: (next, rig) => {
      let armed = true

      return (fake, vector, values) => {
        if (armed && vector.name === 'TELESCOPE_MOTION_WE' && (values.MOTION_EAST === 'On' || values.MOTION_WEST === 'On')) {
          armed = false
          setTimeout(() => rig.mount().cutPower(), 1000).unref()
        }

        return next(fake, vector, values)
      }
    },
    drive: ({ cria }) => cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 3.008, distanceDegrees: 10 }),
  },
  {
    name: 'mount-pole-rotate',
    source: 'recorded',
    episode: 'ZWO AM5, 2026-10-30 evening: at Home (Dec 90) an axis motion was answered Idle after 41 ms, never Busy.',
    tryThis: 'Rotate the mount (the fake mount starts at Home).',
    expect: 'The rotate fails at once (rejected: "the driver answered Idle and did not start MOTION_EAST"); nothing was started, so nothing is stopped and the mount is not held. (Before that rule it ended uncertain after 5 s and held the mount.)',
    outcome: { device: 'mount', kind: 'failed', reason: 'rejected', held: false },
    mountOptions: { rotateIdleAtPole: true },
    declination: 90,
    drive: ({ cria }) => cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 3.008, distanceDegrees: 10 }),
  },
]

export const scenarioNamed = (name: string) => scenarios.find(scenario => scenario.name === name)

export interface RigOptions {
  readonly host?: string
  readonly port?: number
  readonly acknowledgeMs?: number
  readonly token?: string
}

/** The fake errai rig with one scenario's fault, and the real Cria on it. Stop with `stopRig`. */
export async function startRig(scenario: Scenario, options: RigOptions = {}): Promise<Rig & { readonly stop: () => Promise<void> }> {
  const fake = new FakeIndi()

  await fake.start()
  addCamera(fake, names.primary, { width: 960, height: 640 })
  addCamera(fake, names.guide, { width: 640, height: 480, mono: true })
  addMount(fake, names.mount)
  fake.update(names.mount, 'EQUATORIAL_EOD_COORD', { values: { DEC: scenario.declination ?? 40 } })
  fake.define(connection(names.box, scenario.boxDisconnected !== true))
  fake.define({ device: names.box, name: 'POWER_CHANNELS', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { POWER_CHANNEL_1: { value: true } } })
  addDewHeaters(fake, names.box)
  fake.define({
    device: names.box,
    name: 'WEATHER_PARAMETERS',
    kind: 'number',
    perm: 'ro',
    state: 'Ok',
    elements: { WEATHER_TEMPERATURE: { value: 11.5, min: -50, max: 70 }, WEATHER_HUMIDITY: { value: 80, max: 100 }, WEATHER_DEWPOINT: { value: 8.1, min: -50, max: 70 } },
  })

  const mount = am5(fake, names.mount, scenario.mountOptions ?? {})
  const focuser = addEaf(fake, names.focuser, scenario.eaf ?? {})
  const primary = exposeNormally(960, 640)
  const guide = exposeNormally(640, 480)
  const base: Behaviour = (fake, vector, values) => {
    for (const behaviour of [mount.behaviour, focuser, vector.device === names.guide ? guide : primary]) {
      const handled = behaviour(fake, vector, values)

      if (handled === 'handled') return 'handled'
    }

    return 'default'
  }

  fake.behaviour = scenario.wrap ? scenario.wrap(base, { fake, mount: () => mount }) : base
  scenario.alongside?.(fake)

  const cria = await startCria(
    fake.port,
    devices,
    {
      ...(options.host !== undefined || options.port !== undefined ? { listen: { host: options.host ?? '127.0.0.1', port: options.port ?? 0 } } : {}),
      // errai's 5 s unless the caller shortens it (the test harness's own default is 2 s).
      acknowledgeMs: options.acknowledgeMs ?? 5000,
      ...scenario.config,
    },
    options.token === undefined ? {} : { token: options.token },
  )
  const rig = { fake, mount, cria }

  return {
    ...rig,
    stop: async () => {
      await cria.stop()
      await fake.stop()
    },
  }
}
