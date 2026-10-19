/**
 * Test support: the INDI drivers errai's rig has (and the faults a simulator
 * cannot produce), modelled on `FakeIndi` from the protocol and from what was
 * measured on errai. Each model answers from its own state, not from Cria's script.
 */
import { fitsFrame } from '@cria/fits'
import { FakeIndi, type Behaviour, type FakeElement, type FakeVector } from '@cria/fake-indi'

/** A camera, the way INDI::CCD drivers define one. Exposures complete after their duration. */
export function addCamera(
  fake: FakeIndi,
  device: string,
  sensor: { width: number; height: number; widthStep?: number; maxBin?: number; mono?: boolean; upload?: 'client' | 'local' } = { width: 8, height: 6 },
): void {
  const { width, height } = sensor
  const maxBin = sensor.maxBin ?? 4

  fake.define(connection(device))
  fake.define({ device, name: 'CCD_INFO', kind: 'number', perm: 'ro', state: 'Ok', elements: { CCD_MAX_X: { value: width }, CCD_MAX_Y: { value: height }, CCD_PIXEL_SIZE_X: { value: 3.76 }, CCD_PIXEL_SIZE_Y: { value: 3.76 } } })
  fake.define({ device, name: 'CCD_BINNING', kind: 'number', perm: 'rw', state: 'Ok', elements: { HOR_BIN: { value: 1, min: 1, max: maxBin, step: 1 }, VER_BIN: { value: 1, min: 1, max: maxBin, step: 1 } } })
  fake.define({
    device,
    name: 'CCD_FRAME',
    kind: 'number',
    perm: 'rw',
    state: 'Ok',
    elements: {
      X: { value: 0, max: width - 1 },
      Y: { value: 0, max: height - 1 },
      WIDTH: { value: width, min: 1, max: width, step: sensor.widthStep ?? 0 },
      HEIGHT: { value: height, min: 1, max: height },
    },
  })
  fake.define({ device, name: 'CCD_EXPOSURE', kind: 'number', perm: 'rw', state: 'Ok', elements: { CCD_EXPOSURE_VALUE: { value: 1, min: 0.001, max: 3600, step: 1 } } })
  fake.define({ device, name: 'CCD_ABORT_EXPOSURE', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })
  fake.define({ device, name: 'CCD_FRAME_TYPE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { FRAME_LIGHT: { value: true }, FRAME_DARK: { value: false } } })
  if (!sensor.mono)
    fake.define({ device, name: 'CCD_CFA', kind: 'text', perm: 'ro', state: 'Idle', elements: { CFA_OFFSET_X: { value: '1' }, CFA_OFFSET_Y: { value: '0' }, CFA_TYPE: { value: 'RGGB' } } })
  fake.define({ device, name: 'CCD1', kind: 'blob', perm: 'ro', state: 'Idle', elements: { CCD1: { value: '' } } })
  const local = sensor.upload === 'local'

  fake.define({ device, name: 'UPLOAD_MODE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { UPLOAD_CLIENT: { value: !local }, UPLOAD_LOCAL: { value: local }, UPLOAD_BOTH: { value: false } } })
}

export function connection(device: string, connected = true): Omit<FakeVector, 'state'> & { state: FakeVector['state'] } {
  return {
    device,
    name: 'CONNECTION',
    kind: 'switch',
    perm: 'rw',
    rule: 'OneOfMany',
    state: 'Ok',
    elements: { CONNECT: { value: connected }, DISCONNECT: { value: !connected } },
  }
}

/** The usual camera behaviour: exposures run for their duration then deliver a frame. */
export function exposeNormally(width = 8, height = 6): Behaviour {
  return (fake, vector, values) => {
    if (vector.name === 'CCD_EXPOSURE') {
      const seconds = Number(values.CCD_EXPOSURE_VALUE)

      const startedAt = Date.now()

      fake.update(vector.device, vector.name, { state: 'Busy', values: { CCD_EXPOSURE_VALUE: seconds } })
      const timer = setTimeout(() => {
        if (fake.vector(vector.device, 'CCD_EXPOSURE').state !== 'Busy') return
        fake.sendBlob(vector.device, 'CCD1', 'CCD1', fitsFrame(width, height, { exptime: seconds, startedAt }))
        fake.update(vector.device, 'CCD_EXPOSURE', { state: 'Ok', values: { CCD_EXPOSURE_VALUE: 0 } })
      }, seconds * 1000)

      timer.unref()

      return 'handled'
    }

    if (vector.name === 'CCD_ABORT_EXPOSURE') {
      fake.update(vector.device, 'CCD_EXPOSURE', { state: 'Alert', values: { CCD_EXPOSURE_VALUE: 0 } })
      fake.update(vector.device, vector.name, { state: 'Ok' })

      return 'handled'
    }

    return 'default'
  }
}

/**
 * indi_asi_ccd's frame and binning, as measured on errai (2026-10-15):
 *
 * - CCD_FRAME is in unbinned sensor pixels; an image is the frame divided by the binning;
 * - the camera uses a frame whose binned width and height are multiples of
 *   `grid.width` and `grid.height`, and rounds a requested frame down to that;
 * - a frame write publishes the rounded frame, then `echoMs` later the requested
 *   one (the 220MM at bin 2 showed WIDTH=944, then 952), while the camera keeps
 *   using the rounded frame;
 * - an exposure while the published frame differs from the one in use never
 *   completes; only an abort ends it;
 * - a binning write is answered Ok at once, and `recomputeMs` later the driver
 *   rounds the frame to the grid at the new binning by itself (the 2600 went from
 *   6248 to 6240 wide at bin 2 and stayed 6240 back at bin 1); commands that
 *   arrive meanwhile wait their turn;
 * - a frame that leaves the sensor is ignored: the driver answers Ok with the frame it had.
 */
export function zwoFrames(options: { grid: { width: number; height: number }; recomputeMs: number; echoMs: number }): Behaviour {
  type Frame = Record<'X' | 'Y' | 'WIDTH' | 'HEIGHT', number>
  const differ = (a: Frame, b: Frame) => a.X !== b.X || a.Y !== b.Y || a.WIDTH !== b.WIDTH || a.HEIGHT !== b.HEIGHT
  const inUse = new Map<string, Frame>()
  let queue = Promise.resolve()

  const inTurn = (work: () => void, afterMs = 0) => {
    queue = queue.then(() => new Promise(resolve => setTimeout(() => resolve(work()), afterMs).unref()))
  }

  return (fake, vector, values) => {
    const { device } = vector
    const number = (name: string, element: string) => Number(fake.vector(device, name).elements[element]!.value)
    const published = (): Frame => ({ X: number('CCD_FRAME', 'X'), Y: number('CCD_FRAME', 'Y'), WIDTH: number('CCD_FRAME', 'WIDTH'), HEIGHT: number('CCD_FRAME', 'HEIGHT') })
    const used = () => inUse.get(device) ?? published()

    const rounded = (frame: Frame): Frame => {
      const bin = { x: number('CCD_BINNING', 'HOR_BIN'), y: number('CCD_BINNING', 'VER_BIN') }
      const down = (pixels: number, bin: number, step: number) => Math.floor(pixels / bin / step) * step * bin

      return { X: down(frame.X, bin.x, 1), Y: down(frame.Y, bin.y, 1), WIDTH: down(frame.WIDTH, bin.x, options.grid.width), HEIGHT: down(frame.HEIGHT, bin.y, options.grid.height) }
    }

    const use = (frame: Frame) => {
      inUse.set(device, frame)
      fake.update(device, 'CCD_FRAME', { state: 'Ok', values: frame })
    }

    if (vector.name === 'CCD_BINNING') {
      inTurn(() => {
        fake.apply(vector, values)
        fake.update(device, 'CCD_BINNING', { state: 'Ok' })
      })
      inTurn(() => use(rounded(published())), options.recomputeMs)

      return 'handled'
    }

    if (vector.name === 'CCD_FRAME') {
      inTurn(() => {
        const asked = { ...published(), ...Object.fromEntries(Object.entries(values).map(([element, value]) => [element, Number(value)])) }

        if (asked.X + asked.WIDTH > number('CCD_INFO', 'CCD_MAX_X') || asked.Y + asked.HEIGHT > number('CCD_INFO', 'CCD_MAX_Y')) {
          fake.update(device, 'CCD_FRAME', { state: 'Ok' })

          return
        }

        const camera = rounded(asked)

        use(camera)
        if (differ(camera, asked)) inTurn(() => fake.update(device, 'CCD_FRAME', { state: 'Ok', values: asked }), options.echoMs)
      })

      return 'handled'
    }

    const frame = used()

    if (vector.name === 'CCD_EXPOSURE' && differ(frame, published())) {
      fake.update(device, 'CCD_EXPOSURE', { state: 'Busy', values: { CCD_EXPOSURE_VALUE: Number(values.CCD_EXPOSURE_VALUE) } })

      return 'handled'
    }

    return exposeNormally(frame.WIDTH / number('CCD_BINNING', 'HOR_BIN'), frame.HEIGHT / number('CCD_BINNING', 'VER_BIN'))(fake, vector, values)
  }
}

export function addDewHeaters(fake: FakeIndi, device: string): void {
  const dewChannels = (value: (channel: string) => FakeElement) => ({ DEW_CHANNEL_1: value('DEW_CHANNEL_1'), DEW_CHANNEL_2: value('DEW_CHANNEL_2') })

  fake.define({ device, name: 'DEW_CHANNELS', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Idle', elements: dewChannels(() => ({ value: true })) })
  fake.define({ device, name: 'DEW_DUTY_CYCLES', kind: 'number', perm: 'rw', state: 'Idle', elements: dewChannels(() => ({ value: 0, min: 0, max: 100, step: 10 })) })
  fake.define({ device, name: 'AUTO_DEW_CONTROL', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Idle', elements: { DEW_CHANNEL_1: { value: true, label: 'Auto Dew Control' } } })
}

/**
 * indi_pegasus_ppba's dew duty, as measured on errai (2026-10-15): the box
 * holds a duty in 255 steps (10 % applies as 9.8039), and while auto dew is on
 * it accepts a manual duty and then sets it back to 0 `overrideMs` later.
 */
export function pegasusDew(options: { overrideMs: number }): Behaviour {
  return (fake, vector, values) => {
    if (vector.name !== 'DEW_DUTY_CYCLES') return 'default'
    const quantized = Object.fromEntries(Object.entries(values).map(([element, value]) => [element, (Math.floor((Number(value) * 255) / 100) * 100) / 255]))

    fake.update(vector.device, vector.name, { state: 'Ok', values: quantized })
    if (fake.vector(vector.device, 'AUTO_DEW_CONTROL').elements.DEW_CHANNEL_1!.value === true)
      setTimeout(() => fake.update(vector.device, vector.name, { state: 'Ok', values: { DEW_CHANNEL_1: 0, DEW_CHANNEL_2: 0 } }), options.overrideMs).unref()

    return 'handled'
  }
}

/** A mount the way errai's AM5 defines one (JNow coordinates, park, home, axis motion, labelled slew rates). */
export function addMount(fake: FakeIndi, device: string): void {
  fake.define(connection(device))
  fake.define({ device, name: 'EQUATORIAL_EOD_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { RA: { value: 2, max: 24 }, DEC: { value: 40, min: -90, max: 90 } } })
  fake.define({ device, name: 'ON_COORD_SET', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Idle', elements: { TRACK: { value: true }, SLEW: { value: false }, SYNC: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_ABORT_MOTION', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_TRACK_STATE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Idle', elements: { TRACK_ON: { value: false }, TRACK_OFF: { value: true } } })
  fake.define({ device, name: 'TELESCOPE_PARK', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { PARK: { value: false }, UNPARK: { value: true } } })
  fake.define({ device, name: 'TELESCOPE_HOME', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { GO: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_MOTION_WE', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { MOTION_WEST: { value: false }, MOTION_EAST: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_MOTION_NS', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { MOTION_NORTH: { value: false }, MOTION_SOUTH: { value: false } } })
  // Named 1x..10x, labelled with the true sidereal multiples, as errai's AM5 does.
  const multiples = ['0.25x', '0.5x', '1x', '2x', '4x', '8x', '20x', '60x', '720x', '1440x']

  fake.define({
    device,
    name: 'TELESCOPE_SLEW_RATE',
    kind: 'switch',
    perm: 'rw',
    rule: 'OneOfMany',
    state: 'Idle',
    elements: Object.fromEntries(multiples.map((label, index) => [`${index + 1}x`, { value: index === 9, label }])),
  })
  fake.define({ device, name: 'GEOGRAPHIC_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { LAT: { value: 40, min: -90, max: 90 }, LONG: { value: 285, max: 360 }, ELEV: { value: 0, min: -200, max: 10000 } } })
  // The AM5's own clock, unset, as errai showed it.
  fake.define({ device, name: 'TIME_UTC', kind: 'text', perm: 'rw', state: 'Ok', elements: { UTC: { value: '2000-01-01T00:56:31' }, OFFSET: { value: '0.00' } } })
}

/**
 * Mount behaviour: a slew, park or home goes Busy and stays Busy until `finishAfterMs`
 * (never, by default); abort stops whatever moves unless `ignoreAbortFor` names it.
 */
export function moveMount(options: { finishAfterMs?: number; ignoreAbortFor?: string } = {}): Behaviour {
  const motions = ['EQUATORIAL_EOD_COORD', 'TELESCOPE_PARK', 'TELESCOPE_HOME', 'TELESCOPE_MOTION_WE', 'TELESCOPE_MOTION_NS']

  return (fake, vector, values) => {
    if (vector.name === 'TELESCOPE_ABORT_MOTION') {
      for (const name of motions) {
        const moving = fake.vector(vector.device, name)

        if (moving.state === 'Busy' && name !== options.ignoreAbortFor) fake.update(vector.device, name, { state: 'Alert' })
      }
      fake.update(vector.device, vector.name, { state: 'Ok' })

      return 'handled'
    }

    if (motions.includes(vector.name) && Object.values(values).some(value => value !== 'Off')) {
      if (vector.name !== 'EQUATORIAL_EOD_COORD') fake.apply(vector, values)
      fake.update(vector.device, vector.name, { state: 'Busy' })
      if (options.finishAfterMs !== undefined) {
        setTimeout(() => {
          if (fake.vector(vector.device, vector.name).state !== 'Busy') return
          if (vector.name === 'EQUATORIAL_EOD_COORD') fake.apply(vector, values)
          fake.update(vector.device, vector.name, { state: 'Ok' })
        }, options.finishAfterMs).unref()
      }

      return 'handled'
    }

    return 'default'
  }
}

export interface Am5Options {
  /** A goto's speed on each axis (the AM5's 9x is about 3°/s). */
  readonly slewDegreesPerSecond?: number
  /** indi_lx200am5 reads the mount once a second and publishes the position only when it changed. */
  readonly publishEveryMs?: number
  /** How long the mount keeps going at speed after an abort or a halt. */
  readonly stopLatencyMs?: number
  readonly decelerationDegreesPerSecond2?: number
  /** Refuse every goto until GEOGRAPHIC_COORD and TIME_UTC are both written (the mount's e7). */
  readonly requireSiteAndTime?: boolean
  /** A fault: the mount acknowledges a stop and never stops. */
  readonly neverStops?: boolean
}

export interface FakeAm5 {
  readonly behaviour: Behaviour
  readonly moving: () => boolean
  /** Where the mount really is: RA in degrees, Dec in degrees. */
  readonly position: () => { readonly ra: number; readonly dec: number }
  /** Where it was when the last halt or abort arrived. */
  readonly haltedAt: () => { readonly ra: number; readonly dec: number } | undefined
}

/**
 * errai's AM5 through indi_lx200am5, as measured on 2026-10-15 (docs/ts/SPEC.md,
 * "Checked on errai"):
 *
 * - a goto is refused until GEOGRAPHIC_COORD and TIME_UTC have both been
 *   written: the mount answers e7, which the driver turns into Alert on the
 *   coordinates with no message;
 * - the position is published every `publishEveryMs`, and only when it changed
 *   (INDI's NewRaDec), so a stationary tracking mount publishes nothing;
 * - an abort or a halt is acknowledged at once, the coordinates going Idle,
 *   while the mount keeps going at speed for `stopLatencyMs` and then
 *   decelerates. A cancelled 3°/s slew coasted about 3.6° over 2 s, and an 8x
 *   rotate overshot by its rate times 0.9 s; where that time goes was not
 *   measured, so it is all modelled after the stop arrives;
 * - with tracking off, RA advances at the sidereal rate.
 */
export function am5(fake: FakeIndi, device: string, options: Am5Options = {}): FakeAm5 {
  const slewSpeed = options.slewDegreesPerSecond ?? 3
  const stopLatencyMs = options.stopLatencyMs ?? 900
  const deceleration = options.decelerationDegreesPerSecond2 ?? 6
  const siderealDegreesPerSecond = 15.041067 / 3600
  const tickMs = 20
  const written = new Set<string>()
  const published = () => fake.vector(device, 'EQUATORIAL_EOD_COORD').elements
  let position = { ra: Number(published().RA!.value) * 15, dec: Number(published().DEC!.value) }
  let velocity = { ra: 0, dec: 0 }
  let target: { ra: number; dec: number } | undefined
  let stopping: { latencyLeftMs: number } | undefined
  let halted: { ra: number; dec: number } | undefined

  const moving = () => velocity.ra !== 0 || velocity.dec !== 0
  const toward = (from: number, to: number) => Math.sign(to - from) * slewSpeed

  const tick = setInterval(() => {
    const seconds = tickMs / 1000

    if (stopping && !options.neverStops) {
      if (stopping.latencyLeftMs > 0) stopping.latencyLeftMs -= tickMs
      else {
        const slower = (speed: number) => Math.sign(speed) * Math.max(0, Math.abs(speed) - deceleration * seconds)

        velocity = { ra: slower(velocity.ra), dec: slower(velocity.dec) }
        if (!moving()) stopping = undefined
      }
    }

    if (target) {
      const step = (from: number, to: number, speed: number) => (Math.abs(to - from) <= Math.abs(speed) * seconds ? to : from + speed * seconds)

      position = { ra: step(position.ra, target.ra, velocity.ra), dec: step(position.dec, target.dec, velocity.dec) }
      velocity = { ra: position.ra === target.ra ? 0 : velocity.ra, dec: position.dec === target.dec ? 0 : velocity.dec }
      if (!moving()) {
        target = undefined
        fake.update(device, 'EQUATORIAL_EOD_COORD', { state: 'Ok', values: { RA: position.ra / 15, DEC: position.dec } })
      }

      return
    }

    position = { ra: position.ra + velocity.ra * seconds, dec: position.dec + velocity.dec * seconds }
    if (fake.vector(device, 'TELESCOPE_TRACK_STATE').elements.TRACK_ON!.value !== true) position = { ...position, ra: position.ra + siderealDegreesPerSecond * seconds }
  }, tickMs)

  const publish = setInterval(() => {
    const ra = position.ra / 15

    if (Math.abs(Number(published().RA!.value) - ra) > 0.1 / 3600 / 15 || Math.abs(Number(published().DEC!.value) - position.dec) > 0.1 / 3600)
      fake.update(device, 'EQUATORIAL_EOD_COORD', { values: { RA: ra, DEC: position.dec } })
  }, options.publishEveryMs ?? 1000)

  tick.unref()
  publish.unref()
  fake.onStop(() => {
    clearInterval(tick)
    clearInterval(publish)
  })

  const stop = () => {
    halted = { ...position }
    target = undefined
    stopping = { latencyLeftMs: stopLatencyMs }
  }

  const behaviour: Behaviour = (fake, vector, values) => {
    if (vector.name === 'GEOGRAPHIC_COORD' || vector.name === 'TIME_UTC') {
      written.add(vector.name)

      return 'default'
    }

    if (vector.name === 'EQUATORIAL_EOD_COORD') {
      if ((options.requireSiteAndTime ?? true) && !(written.has('GEOGRAPHIC_COORD') && written.has('TIME_UTC'))) {
        fake.update(device, vector.name, { state: 'Alert' })

        return 'handled'
      }

      target = { ra: Number(values.RA) * 15, dec: Number(values.DEC) }
      velocity = { ra: toward(position.ra, target.ra), dec: toward(position.dec, target.dec) }
      stopping = undefined
      fake.update(device, vector.name, { state: 'Busy' })

      return 'handled'
    }

    if (vector.name === 'TELESCOPE_MOTION_WE') {
      const direction = values.MOTION_EAST === 'On' ? 1 : values.MOTION_WEST === 'On' ? -1 : 0

      if (direction === 0) {
        if (moving()) stop()
        fake.update(device, vector.name, { state: 'Idle', values: { MOTION_EAST: false, MOTION_WEST: false } })

        return 'handled'
      }

      const rate = fake.vector(device, 'TELESCOPE_SLEW_RATE')
      const label = Object.values(rate.elements).find(element => element.value === true)?.label ?? '1x'

      velocity = { ra: direction * Number.parseFloat(label) * siderealDegreesPerSecond, dec: 0 }
      stopping = undefined
      fake.apply(vector, values)
      fake.update(device, vector.name, { state: 'Busy' })

      return 'handled'
    }

    if (vector.name === 'TELESCOPE_ABORT_MOTION') {
      if (moving()) stop()
      if (fake.vector(device, 'EQUATORIAL_EOD_COORD').state === 'Busy') fake.update(device, 'EQUATORIAL_EOD_COORD', { state: 'Idle' })
      if (fake.vector(device, 'TELESCOPE_MOTION_WE').state === 'Busy')
        fake.update(device, 'TELESCOPE_MOTION_WE', { state: 'Idle', values: { MOTION_EAST: false, MOTION_WEST: false } })
      fake.update(device, vector.name, { state: 'Ok' })

      return 'handled'
    }

    return 'default'
  }

  return { behaviour, moving, position: () => position, haltedAt: () => halted }
}

/**
 * errai's ZWO EAF through indi_asi_focuser, as recorded on 2026-10-15: the
 * driver's `FOCUS_MAX` (a user setting) says 100000 while `ABS_FOCUS_POSITION`
 * allows 0 to 60000, and backlash compensation is off. A target outside the
 * position's own range goes Alert without moving, as libindi's focuser
 * interface answers it; any other target goes Busy and arrives after `moveMs`.
 */
export function addEaf(fake: FakeIndi, device: string, options: { position?: number; moveMs?: number } = {}): Behaviour {
  const moveMs = options.moveMs ?? 100

  fake.define(connection(device))
  fake.define({ device, name: 'ABS_FOCUS_POSITION', kind: 'number', perm: 'rw', state: 'Ok', elements: { FOCUS_ABSOLUTE_POSITION: { value: options.position ?? 32749, min: 0, max: 60000, step: 30000 } } })
  fake.define({ device, name: 'FOCUS_MAX', kind: 'number', perm: 'rw', state: 'Ok', elements: { FOCUS_MAX_VALUE: { value: 100000, min: 1000, max: 600000, step: 10000 } } })
  fake.define({ device, name: 'FOCUS_TEMPERATURE', kind: 'number', perm: 'ro', state: 'Ok', elements: { TEMPERATURE: { value: 24, min: -50, max: 70 } } })
  fake.define({ device, name: 'FOCUS_ABORT_MOTION', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })

  return (fake, vector, values) => {
    const position = fake.vector(device, 'ABS_FOCUS_POSITION')

    if (vector.name === 'FOCUS_ABORT_MOTION') {
      if (position.state === 'Busy') fake.update(device, position.name, { state: 'Idle' })
      fake.update(device, vector.name, { state: 'Ok' })

      return 'handled'
    }

    if (vector.name !== position.name) return 'default'
    const target = Number(values.FOCUS_ABSOLUTE_POSITION)
    const range = position.elements.FOCUS_ABSOLUTE_POSITION!

    if (target < range.min! || target > range.max!) {
      fake.update(device, position.name, { state: 'Alert', message: 'Requested position out of bound' })

      return 'handled'
    }

    fake.update(device, position.name, { state: 'Busy' })
    setTimeout(() => {
      if (position.state !== 'Busy') return
      fake.update(device, position.name, { state: 'Ok', values: { FOCUS_ABSOLUTE_POSITION: target } })
    }, moveMs).unref()

    return 'handled'
  }
}
