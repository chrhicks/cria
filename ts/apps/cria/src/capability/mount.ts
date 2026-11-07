/**
 * Capability: mount. An INDI telescope seen through the disciplines: slews,
 * home and axis motion are `stoppable` (abort on cancel, confirm the
 * mount stopped); tracking is `switchConfirmed`.
 *
 * Cria reports coordinates in the frame of the property it reads and never
 * converts frames: EQUATORIAL_EOD_COORD is JNow ("topocentric" in ASCOM's
 * vocabulary), EQUATORIAL_COORD is J2000. A slew must already be expressed in
 * that frame.
 */
import { Effect, Option } from 'effect'
import { selectedSwitch, type Property, type Values } from '@cria/indi'
import { Failed, Reading, Uncertain, stoppable, type Ending } from '@cria/primitives'
import type { MountMotionSettings } from '../config.js'
import { sendOnce, startMotion, switchConfirmed, switchNotStarted, untilSettled } from './commands.js'
import { invalid, liveSnapshot, required, type CapabilityContext } from './context.js'
import { numberElement, switchElement, type DeviceSnapshot } from './fields.js'
import type { DeviceSetup, StepOutcome } from './setup.js'
import { track, type Note, type Tracking } from './motion-record.js'
import { makeRotate } from './rotate.js'
import { angularDelta, beforeCommand, confirmStopped, positionOf, type Command, type Position } from './stopped.js'
import type { DeviceBody, MotionCommanded, ParamsOf, ReadingsOf } from '@cria/wire'

type CoordinateFrame = ParamsOf<'mount-slew'>['coordinateSystem']

export interface AxisRate {
  readonly name: string
  readonly degreesPerSecond: number
}

export interface Mount {
  readonly observe: Effect.Effect<DeviceBody<'mount'>>
  readonly slew: (target: ParamsOf<'mount-slew'>, note: Note) => Effect.Effect<{ rightAscensionDegrees: number; declinationDegrees: number }, Ending>
  readonly setTracking: (tracking: boolean) => Effect.Effect<{ tracking: boolean }, Failed | Uncertain>
  readonly home: (note: Note) => Effect.Effect<{}, Ending>
  readonly stop: (note: Note) => Effect.Effect<{}, Failed | Uncertain>
  /** Moves the primary axis at a rate for a time, then stops it. */
  readonly moveAxis: (rateDegreesPerSecond: number, durationSeconds: number, note: Note) => Effect.Effect<AxisTravel, Ending>
  /** Moves the primary axis until RA has travelled `distanceDegrees`, then stops it. */
  readonly rotate: (rateDegreesPerSecond: number, distanceDegrees: number, note: Note) => Effect.Effect<AxisTravel, Ending>
}

export type AxisTravel = {
  readonly rightAscensionDegrees: number
  readonly rate: string
  /** RA travelled from the start to where the mount stood still, east positive. */
  readonly travelledDegrees: number
}

const siderealArcsecondsPerSecond = 15.041067

/** Properties whose Alert means "the last command failed", not "this value is old". */
const command = { alertMeansStale: false }

const stopWithinMs = 20_000

const gotoToleranceDegrees = 0.1

function coordinatesProperty(snapshot: DeviceSnapshot): { name: string; frame: CoordinateFrame } {
  return snapshot.property('EQUATORIAL_EOD_COORD') || !snapshot.property('EQUATORIAL_COORD')
    ? { name: 'EQUATORIAL_EOD_COORD', frame: 'topocentric' }
    : { name: 'EQUATORIAL_COORD', frame: 'j2000' }
}

function pierSideOf(property: Property) {
  const side = selectedSwitch(property)
  return side === 'PIER_EAST' ? 'east' : side === 'PIER_WEST' ? 'west' : 'unknown'
}

function readings(snapshot: DeviceSnapshot): ReadingsOf<'mount'> {
  const read = snapshot.reading
  const coordinates = coordinatesProperty(snapshot)
  const longitude = read('GEOGRAPHIC_COORD', property => {
    const east = numberElement('LONG')(property)

    return east === undefined ? undefined : east > 180 ? east - 360 : east
  })

  return {
    connected: snapshot.connected,
    name: snapshot.name,
    // Alert on the coordinates means a slew failed; the position is still reported.
    rightAscensionHours: read(coordinates.name, numberElement('RA'), command),
    declinationDegrees: read(coordinates.name, numberElement('DEC'), command),
    siderealTimeHours: Reading.map(longitude, east => localSiderealHours(Date.now(), east)),
    slewing: read(coordinates.name, property => property.state === 'Busy', command),
    tracking: read('TELESCOPE_TRACK_STATE', switchElement('TRACK_ON')),
    trackingRate: read('TELESCOPE_TRACK_MODE', property => {
      const mode = selectedSwitch(property)

      return mode === 'TRACK_SIDEREAL' ? 'sidereal' : mode === 'TRACK_LUNAR' ? 'lunar' : mode === 'TRACK_SOLAR' ? 'solar' : undefined
    }),
    pierSide: read('TELESCOPE_PIER_SIDE', pierSideOf),
    coordinateSystem: read(coordinates.name, () => coordinates.frame),
    latitudeDegrees: read('GEOGRAPHIC_COORD', numberElement('LAT')),
    longitudeDegrees: longitude,
    elevationMeters: read('GEOGRAPHIC_COORD', numberElement('ELEV')),
    canSlew: read(coordinates.name, property => property.perm !== 'ro'),
    canSetTracking: read(coordinates.name, () => snapshot.property('TELESCOPE_TRACK_STATE')?.perm === 'rw'),
    canFindHome: read(coordinates.name, () => homeElement(snapshot.property('TELESCOPE_HOME')) !== undefined),
    canMovePrimaryAxis: read(coordinates.name, () => snapshot.property('TELESCOPE_MOTION_WE') !== undefined),
    primaryAxisRates: read('TELESCOPE_SLEW_RATE', axisRates),
  }
}

/** Greenwich mean sidereal time (IAU 1982, good to well under a second) plus longitude. */
export function localSiderealHours(epochMs: number, eastLongitudeDegrees: number): number {
  const daysSinceJ2000 = epochMs / 86_400_000 + 2440587.5 - 2451545.0
  const greenwich = 18.697374558 + 24.06570982441908 * daysSinceJ2000
  const local = greenwich + eastLongitudeDegrees / 15

  return ((local % 24) + 24) % 24
}

function homeElement(property: Property | undefined): string | undefined {
  if (!property) return undefined

  return ['GO', 'FIND'].find(name => property.elements.has(name))
}

/** INDI slew rates are named multiples of sidereal ("16x"); unnamed ones are skipped. */
function axisRates(property: Property): ReadonlyArray<AxisRate> {
  const rates: AxisRate[] = []

  for (const element of property.elements.values()) {
    const multiple = /^(\d+(\.\d+)?)x$/i.exec(element.label.trim()) ?? /^(\d+(\.\d+)?)x$/i.exec(element.name.trim())

    if (multiple) rates.push({ name: element.name, degreesPerSecond: (Number(multiple[1]) * siderealArcsecondsPerSecond) / 3600 })
  }

  return rates
}

/** Within 0.1° of the slew target, as the .NET Cria checked: where the slew landed, not whether the mount stopped. */
function onTarget(position: Position, target: ParamsOf<'mount-slew'>): boolean {
  return Math.abs(angularDelta(position.ra, target.rightAscensionDegrees)) <= gotoToleranceDegrees && Math.abs(position.dec - target.declinationDegrees) <= gotoToleranceDegrees
}

function gotoRefusalHint(outcomes: ReadonlyArray<StepOutcome> | undefined): string | undefined {
  if (outcomes?.every(outcome => outcome.done)) return undefined
  const done = outcomes === undefined ? 'Cria has not set it up since it connected' : `Setup since it connected: ${outcomes.map(outcome => outcome.text).join('; ')}`

  return `An AM5 refuses every goto until its site and time are set after it powers on. ${done}`
}

export function makeMount(context: CapabilityContext, motion: MountMotionSettings, setup: DeviceSetup): Mount {
  const { device, timing } = context

  // Stopped is decided by where the mount is, never by a property's state (see stopped.ts).
  const stopWith = (property: string, values: Values, how: 'halted' | 'aborted', tracking: Tracking, sending: Tracking['sentBy'] = send => send) =>
    Effect.gen(function* () {
      const command = yield* beforeCommand(device)

      yield* sending(sendOnce(device, property, values, timing))
      const position = yield* confirmStopped(device, motion, command, 15_000)

      yield* tracking.rested(how, position)

      return position
    })
  const abort = (tracking: Tracking, sending?: Tracking['sentBy']) =>
    Effect.asVoid(stopWith('TELESCOPE_ABORT_MOTION', { ABORT: true }, 'aborted', tracking, sending))
  // The driver says the motion is over (the property left Busy); the mount has stopped once its position stands still.
  const settled = (command: Command, tracking: Tracking) =>
    Effect.tap(confirmStopped(device, motion, command, 15_000), position => tracking.rested('arrived', position))

  const idle = (snapshot: DeviceSnapshot) =>
    Effect.gen(function* () {
      const mount = readings(snapshot)

      if (yield* required(mount.slewing, 'mount motion'))
        return yield* new Failed({ reason: 'busy', message: 'The mount is already moving' })

      return mount
    })

  const slew = (target: ParamsOf<'mount-slew'>, note: Note) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const mount = yield* idle(snapshot)
      const coordinates = coordinatesProperty(snapshot)

      if (!(yield* required(mount.canSlew, 'slew support')))
        return yield* new Failed({ reason: 'unsupported', message: 'The mount cannot slew' })
      if ((yield* required(mount.coordinateSystem, 'coordinate frame')) !== target.coordinateSystem)
        return yield* invalid(`Coordinates must be in the mount's frame (${coordinates.frame}); Cria never converts frames`)

      const onSet = snapshot.property('ON_COORD_SET')

      if (onSet && switchElement('TRACK')(onSet) !== true)
        yield* switchConfirmed(device, 'ON_COORD_SET', { TRACK: true }, found => switchElement('TRACK')(found) === true, timing)

      const hint = gotoRefusalHint(yield* setup.current)
      const command = yield* beforeCommand(device)
      const tracking = yield* track(device,
        note,
        { kind: 'slew', sentAt: command.sentAt, target: { rightAscensionDegrees: target.rightAscensionDegrees, declinationDegrees: target.declinationDegrees } },
        command,
      )
      const arrived = yield* stoppable({
        command: `slew on ${device.name}`,
        start: tracking.sentBy(startMotion(device, coordinates.name, { RA: target.rightAscensionDegrees / 15, DEC: target.declinationDegrees }, timing, {
          arrived: property => onTarget(positionOf(property), target),
        }).pipe(
          Effect.mapError(error =>
            error._tag === 'Failed' && error.reason === 'rejected' && hint
              ? new Failed({ reason: 'rejected', message: `The mount refused the goto (Alert on ${coordinates.name}). ${hint}` })
              : error,
          ),
        )),
        settle: Effect.andThen(untilSettled(device, coordinates.name, () => true, timing.operationTimeoutMs), settled(command, tracking)),
        stop: abort(tracking),
        stopWithin: stopWithinMs,
      })

      if (!onTarget(arrived, target))
        // The mount moved, just not to the target: not "failed" (which means nothing happened).
        return yield* new Uncertain({
          reason: 'not-confirmed',
          message: `Slew stopped outside the target tolerance at RA ${arrived.ra.toFixed(3)}°, Dec ${arrived.dec.toFixed(3)}°`,
        })

      return { rightAscensionDegrees: arrived.ra, declinationDegrees: arrived.dec }
    }).pipe(Effect.scoped)

  const setTracking = (tracking: boolean) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const mount = readings(snapshot)

      if (!(yield* required(mount.canSetTracking, 'tracking control')))
        return yield* new Failed({ reason: 'unsupported', message: 'Tracking control unsupported' })

      yield* switchConfirmed(
        device,
        'TELESCOPE_TRACK_STATE',
        tracking ? { TRACK_ON: true } : { TRACK_OFF: true },
        property => switchElement('TRACK_ON')(property) === tracking,
        timing,
      )

      return { tracking }
    })

  const home = (note: Note) => Effect.gen(function* () {
    const snapshot = yield* liveSnapshot(context)

    yield* idle(snapshot)
    const element = homeElement(snapshot.property('TELESCOPE_HOME'))

    if (!element) return yield* new Failed({ reason: 'unsupported', message: 'Home unsupported' })

    const command = yield* beforeCommand(device)
    const tracking = yield* track(device, note, { kind: 'home', sentAt: command.sentAt }, command)

    yield* stoppable({
      command: `home on ${device.name}`,
      // TELESCOPE_HOME is not polled, so an Ok right after the send is the driver's answer:
      // already home (the AM5 has no at-home indicator to check first).
      start: tracking.sentBy(startMotion(device, 'TELESCOPE_HOME', { [element]: true }, timing, { arrived: property => property.state === 'Ok' })),
      settle: Effect.andThen(untilSettled(device, 'TELESCOPE_HOME', () => true, timing.operationTimeoutMs), settled(command, tracking)),
      stop: abort(tracking),
      stopWithin: stopWithinMs,
    })

    return {}
  }).pipe(Effect.scoped)

  const stop = (note: Note) =>
    Effect.gen(function* () {
      const command = yield* beforeCommand(device)
      const tracking = yield* track(device, note, { kind: 'stop', sentAt: command.sentAt }, command)

      return yield* abort(tracking, tracking.sentBy).pipe(
        Effect.timeoutOption(stopWithinMs),
        Effect.mapError(error => (error._tag === 'Uncertain' && error.reason === 'not-confirmed' ? new Uncertain({ reason: 'stop-not-confirmed', message: error.message }) : error)),
        Effect.flatMap(
          Option.match({
            onSome: () => Effect.succeed({}),
            onNone: () => Effect.fail(new Uncertain({ reason: 'stop-not-confirmed', message: `stop on ${device.name}: not confirmed within ${stopWithinMs / 1000} s` })),
          }),
        ),
      )
    }).pipe(Effect.scoped)

  /**
   * Primary-axis motion at one of the rates the mount advertises (review R1-#12).
   * Positive rates move east (increasing RA): an assumption to check by hand in
   * the first session with Chris present.
   */
  const axisMotion = (
    rateDegreesPerSecond: number,
    until: (travelled: Effect.Effect<number, Failed>) => Effect.Effect<void, Failed>,
    commanded: (rateDegreesPerSecond: number, sentAt: number) => MotionCommanded,
    note: Note,
    continuing = false,
  ) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const mount = continuing ? readings(snapshot) : yield* idle(snapshot)

      if (!(yield* required(mount.canMovePrimaryAxis, 'axis motion')))
        return yield* new Failed({ reason: 'unsupported', message: 'Axis motion unsupported' })

      const rates = yield* required(mount.primaryAxisRates, 'axis rates')
      const rate = advertisedRate(rates, Math.abs(rateDegreesPerSecond))

      if (!rate) {
        const offered = rates.map(candidate => `${candidate.degreesPerSecond.toPrecision(4)}`).join(', ')

        return yield* invalid(`The mount does not offer ${Math.abs(rateDegreesPerSecond)}°/s; it offers ${offered}°/s`)
      }

      const slewRate = snapshot.property('TELESCOPE_SLEW_RATE')

      if (slewRate && selectedSwitch(slewRate) !== rate.name)
        yield* switchConfirmed(device, 'TELESCOPE_SLEW_RATE', { [rate.name]: true }, found => selectedSwitch(found) === rate.name, timing)

      const direction = rateDegreesPerSecond > 0 ? 'MOTION_EAST' : 'MOTION_WEST'
      const ra = Effect.gen(function* () {
        const latest = yield* context.snapshot

        return (yield* required(readings(latest).rightAscensionHours, 'right ascension')) * 15
      })
      const start = yield* ra
      const command = yield* beforeCommand(device)
      const phaseNote: Note = record => note({
        ...record,
        observed: { ...record.observed,
          from: command.before === undefined ? record.observed.from : { rightAscensionDegrees: start, declinationDegrees: command.before.dec },
          travel: record.observed.to === null ? null : {
            rightAscensionDegrees: angularDelta(record.observed.to.rightAscensionDegrees, start),
            declinationDegrees: record.observed.to.declinationDegrees - (command.before?.dec ?? record.observed.to.declinationDegrees),
          },
        },
      })
      const tracking = yield* track(device, phaseNote, commanded(Math.sign(rateDegreesPerSecond) * rate.degreesPerSecond, command.sentAt), command)
      const halt = Effect.gen(function* () {
        const command = yield* beforeCommand(device)
        yield* sendOnce(device, 'TELESCOPE_MOTION_WE', { MOTION_EAST: false, MOTION_WEST: false }, timing)
        const position = yield* confirmStopped(device, motion, command, 15_000)
        const coastDegrees = command.before === undefined ? undefined
          : angularDelta(position.ra, command.before.ra) * Math.sign(rateDegreesPerSecond)
        yield* tracking.rested('halted', position, coastDegrees)
      })

      yield* stoppable({
        command: `axis motion on ${device.name}`,
        start: tracking.sentBy(startMotion(device, 'TELESCOPE_MOTION_WE', { [direction]: true }, timing, { refused: switchNotStarted(direction) })),
        // A normal finish stops the axis too; a second stop after a cancel is harmless.
        settle: Effect.andThen(until(Effect.map(ra, now => angularDelta(now, start))), halt),
        stop: halt,
        stopWithin: stopWithinMs,
      })

      const end = yield* ra

      return { rightAscensionDegrees: end, rate: rate.name, travelledDegrees: angularDelta(end, start) }
    }).pipe(Effect.scoped)

  const moveAxis = (rateDegreesPerSecond: number, durationSeconds: number, note: Note) =>
    axisMotion(rateDegreesPerSecond, () => Effect.sleep(durationSeconds * 1000), (rate, sentAt) => ({ kind: 'axis', sentAt, axis: 'ra', rateDegreesPerSecond: rate }), note)

  const rotate = makeRotate({
    prepare: Effect.gen(function* () {
      const mount = yield* idle(yield* liveSnapshot(context))

      return {
        rates: yield* required(mount.primaryAxisRates, 'axis rates'),
        rightAscensionDegrees: (yield* required(mount.rightAscensionHours, 'right ascension')) * 15,
        declinationDegrees: yield* required(mount.declinationDegrees, 'declination'),
      }
    }),
    axisMotion,
    motion,
  })

  return {
    observe: Effect.map(context.snapshot, snapshot => ({ kind: 'mount', readings: readings(snapshot) })),
    slew,
    setTracking,
    home,
    stop,
    moveAxis,
    rotate,
  }
}

/**
 * The advertised rate within 1% of the request. No rounding to the nearest:
 * a polar-alignment rotate at 8x when 4x was asked is not the same motion.
 */
export function advertisedRate(rates: ReadonlyArray<AxisRate>, degreesPerSecond: number): AxisRate | undefined {
  return rates.find(rate => Math.abs(rate.degreesPerSecond - degreesPerSecond) <= degreesPerSecond * 0.01)
}
