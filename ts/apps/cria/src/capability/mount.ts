/**
 * Capability: mount. An INDI telescope seen through the disciplines: slews,
 * park, home and axis motion are `stoppable` (abort on cancel, confirm the
 * mount stopped); tracking and unpark are `switchConfirmed`.
 *
 * Cria reports coordinates in the frame of the property it reads and never
 * converts frames: EQUATORIAL_EOD_COORD is JNow ("topocentric" in ASCOM's
 * vocabulary), EQUATORIAL_COORD is J2000. A slew must already be expressed in
 * that frame.
 */
import { Clock, Effect, Option, Stream } from 'effect'
import { selectedSwitch, type Property, type Values } from '@cria/indi'
import { Failed, Reading, Uncertain, stoppable, type Ending } from '@cria/primitives'
import type { MountMotionSettings } from '../config.js'
import { sendOnce, startMotion, switchConfirmed, switchNotStarted, untilSettled } from './commands.js'
import { invalid, liveSnapshot, required, type CapabilityContext } from './context.js'
import { numberElement, switchElement, type DeviceSnapshot } from './fields.js'
import type { DeviceSetup, StepOutcome } from './setup.js'
import { track, type Note, type Tracking } from './motion-record.js'
import { angularDelta, beforeCommand, confirmStopped, positionOf, type Command, type Position } from './stopped.js'
import { makeBlindTravel } from './blind-travel.js'
import { gotoRefusal, rateRefusal, reactionDegrees, readingDeadlineMs, watchRefusal, type MountPose } from './envelope.js'
import type { DeviceBody, MotionCommanded, ParamsOf, ReadingsOf } from '@cria/wire'

type CoordinateFrame = ParamsOf<'mount-slew'>['coordinateSystem']

export interface AxisRate {
  readonly name: string
  readonly degreesPerSecond: number
}

export interface Mount {
  readonly watchTravel: Effect.Effect<void>
  readonly observe: Effect.Effect<DeviceBody<'mount'>>
  readonly slew: (target: ParamsOf<'mount-slew'>, note: Note) => Effect.Effect<{ rightAscensionDegrees: number; declinationDegrees: number }, Ending>
  readonly setTracking: (tracking: boolean) => Effect.Effect<{ tracking: boolean }, Failed | Uncertain>
  readonly park: (note: Note) => Effect.Effect<{}, Ending>
  readonly unpark: Effect.Effect<{}, Failed | Uncertain>
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

function coordinatesProperty(snapshot: DeviceSnapshot): { name: string; frame: CoordinateFrame } {
  return snapshot.property('EQUATORIAL_EOD_COORD') || !snapshot.property('EQUATORIAL_COORD')
    ? { name: 'EQUATORIAL_EOD_COORD', frame: 'topocentric' }
    : { name: 'EQUATORIAL_COORD', frame: 'j2000' }
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
    siderealTimeHours: snapshot.property('TIME_LST')
      ? read('TIME_LST', numberElement('LST'))
      : Reading.map(longitude, east => localSiderealHours(Date.now(), east)),
    slewing: read(coordinates.name, property => property.state === 'Busy', command),
    tracking: read('TELESCOPE_TRACK_STATE', switchElement('TRACK_ON')),
    parked: read('TELESCOPE_PARK', switchElement('PARK')),
    trackingRate: read('TELESCOPE_TRACK_MODE', property => {
      const mode = selectedSwitch(property)

      return mode === 'TRACK_SIDEREAL' ? 'sidereal' : mode === 'TRACK_LUNAR' ? 'lunar' : mode === 'TRACK_SOLAR' ? 'solar' : undefined
    }),
    rightAscensionRateSecondsPerSiderealSecond: read('TELESCOPE_TRACK_RATE', property => {
      const rate = numberElement('TRACK_RATE_RA')(property)

      // ASCOM: offset from sidereal, in seconds of RA per sidereal second.
      return rate === undefined ? undefined : ((rate - siderealArcsecondsPerSecond) / 15) * 0.99726957
    }),
    declinationRateArcsecondsPerSecond: read('TELESCOPE_TRACK_RATE', numberElement('TRACK_RATE_DE')),
    pierSide: read('TELESCOPE_PIER_SIDE', property => {
      const side = selectedSwitch(property)

      return side === 'PIER_EAST' ? 'east' : side === 'PIER_WEST' ? 'west' : 'unknown'
    }),
    coordinateSystem: read(coordinates.name, () => coordinates.frame),
    latitudeDegrees: read('GEOGRAPHIC_COORD', numberElement('LAT')),
    longitudeDegrees: longitude,
    elevationMeters: read('GEOGRAPHIC_COORD', numberElement('ELEV')),
    canSlew: read(coordinates.name, property => property.perm !== 'ro'),
    canSetTracking: read(coordinates.name, () => snapshot.property('TELESCOPE_TRACK_STATE')?.perm === 'rw'),
    canFindHome: read(coordinates.name, () => homeElement(snapshot.property('TELESCOPE_HOME')) !== undefined),
    canPark: read(coordinates.name, () => snapshot.property('TELESCOPE_PARK') !== undefined),
    canUnpark: read(coordinates.name, () => snapshot.property('TELESCOPE_PARK') !== undefined),
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
  return Math.abs(angularDelta(position.ra, target.rightAscensionDegrees)) <= 0.1 && Math.abs(position.dec - target.declinationDegrees) <= 0.1
}

function gotoRefusalHint(outcomes: ReadonlyArray<StepOutcome> | undefined): string | undefined {
  if (outcomes?.every(outcome => outcome.done)) return undefined
  const done = outcomes === undefined ? 'Cria has not set it up since it connected' : `Setup since it connected: ${outcomes.map(outcome => outcome.text).join('; ')}`

  return `An AM5 refuses every goto until its site and time are set after it powers on. ${done}`
}

export function makeMount(context: CapabilityContext, motion: MountMotionSettings, setup: DeviceSetup): Mount {
  const { device, timing } = context

  const blindTravel = makeBlindTravel()
  const watchTravel = Stream.runForEach(device.events, event => Effect.sync(() => {
    if (event.type === 'property' && ['EQUATORIAL_EOD_COORD', 'EQUATORIAL_COORD'].includes(event.property.name)) blindTravel.record({ ...positionOf(event.property), at: event.property.receivedAt })
  }))

  const guard = <A>(settle: Effect.Effect<A, Failed | Uncertain>, stopped: { reason?: string }, target: ParamsOf<'mount-slew'> | number, command: Command) => {
    const monitor = Effect.gen(function* () {
      const subscription = yield* device.subscribe
      let first = Option.getOrUndefined(yield* device.property('EQUATORIAL_EOD_COORD')) ?? Option.getOrUndefined(yield* device.property('EQUATORIAL_COORD'))
      let last = command.before
      let lastPositionAt = yield* Clock.currentTimeMillis
      let raDirection = 0
      let decDirection = 0
      while (true) {
        let property = first
        first = undefined
        if (property === undefined) {
          const elapsed = (yield* Clock.currentTimeMillis) - lastPositionAt
          const next = elapsed >= readingDeadlineMs ? Option.none() : yield* Effect.timeoutOption(subscription.next, readingDeadlineMs - elapsed)
          if (Option.isNone(next)) {
            if (context.feedback.envelope === null) { lastPositionAt = yield* Clock.currentTimeMillis; continue }
            stopped.reason = 'Envelope position reading deadline exceeded; stopping before the reserved reaction travel is spent'
            return yield* new Failed({ reason: 'unavailable', message: stopped.reason })
          }
          const event = next.value
          if (event.type !== 'property' || !['EQUATORIAL_EOD_COORD', 'EQUATORIAL_COORD'].includes(event.property.name)) continue
          property = event.property
        }
        blindTravel.record({ ...positionOf(property), at: property.receivedAt })
        lastPositionAt = yield* Clock.currentTimeMillis
        const here = positionOf(property)
        if (last !== undefined) {
          const dra = angularDelta(here.ra, last.ra)
          const ddec = here.dec - last.dec
          if (Math.abs(dra) > 1e-9) raDirection = Math.sign(dra)
          if (Math.abs(ddec) > 1e-9) decDirection = Math.sign(ddec)
        }
        last = here
        const envelope = context.feedback.envelope
        if (envelope === null) continue
        const snapshot = yield* context.snapshot
        const mount = readings(snapshot)
        const ra = here.ra / 15
        const dec = here.dec
        const lst = yield* required(mount.siderealTimeHours, 'envelope LST')
        const side = yield* required(mount.pierSide, 'envelope pier side')
        const limit = snapshot.reading('MERIDIAN_LIMIT', numberElement('LIMIT'))
        const margin = blindTravel.margin(context.feedback.fix) / 60
        const refusal = side === 'unknown' ? 'Envelope needs a known pier side'
          : watchRefusal(envelope, { hourAngleDegrees: angularDelta(lst * 15, ra * 15), declinationDegrees: dec, pierSide: side }, limit.status === 'fresh' ? limit.value : 0, margin,
            -(raDirection || (typeof target === 'number' ? Math.sign(target) : Math.sign(angularDelta(target.rightAscensionDegrees, ra * 15)))) * reactionDegrees,
            (decDirection || (typeof target === 'number' ? 0 : Math.sign(target.declinationDegrees - dec))) * reactionDegrees)
        if (refusal !== undefined) {
          stopped.reason = `${refusal}; envelope margin ${margin.toFixed(3)}° plus ${reactionDegrees.toFixed(3)}° reaction travel`
          return yield* new Failed({ reason: 'invalid', message: stopped.reason })
        }
      }
    })
    return Effect.raceFirst(settle, monitor).pipe(Effect.scoped)
  }

  // Stopped is decided by where the mount is, never by a property's state (see stopped.ts).
  const stopWith = (property: string, values: Values, how: 'halted' | 'aborted', tracking: Tracking, sending: Tracking['sentBy'] = send => send, reason?: string) =>
    Effect.gen(function* () {
      const command = yield* beforeCommand(device)

      yield* sending(sendOnce(device, property, values, timing))
      const position = yield* confirmStopped(device, motion, command, 15_000)

      yield* tracking.rested(how, position, reason)

      return position
    })
  const abort = (tracking: Tracking, sending?: Tracking['sentBy'], reason?: string) =>
    Effect.asVoid(stopWith('TELESCOPE_ABORT_MOTION', { ABORT: true }, 'aborted', tracking, sending, reason))
  // The driver says the motion is over (the property left Busy); the mount has stopped once its position stands still.
  const settled = (command: Command, tracking: Tracking) =>
    Effect.tap(confirmStopped(device, motion, command, 15_000), position => tracking.rested('arrived', position))

  const idleAndUnparked = (snapshot: DeviceSnapshot, allowParked = false) =>
    Effect.gen(function* () {
      const mount = readings(snapshot)

      if (yield* required(mount.slewing, 'mount motion'))
        return yield* new Failed({ reason: 'busy', message: 'The mount is already moving' })
      if (!allowParked && (yield* required(mount.parked, 'park state')))
        return yield* new Failed({ reason: 'invalid', message: 'The mount is parked' })

      return mount
    })

  const checkEnvelope = (snapshot: DeviceSnapshot, target: ParamsOf<'mount-slew'> | number) => Effect.gen(function* () {
    const envelope = context.feedback.envelope

    if (envelope === null) return
    const position = snapshot.property(coordinatesProperty(snapshot).name)
    if (position !== undefined) blindTravel.record({ ...positionOf(position), at: position.receivedAt })
    const mount = readings(snapshot)
    const pierSide = yield* required(mount.pierSide, 'envelope pier side')

    if (pierSide === 'unknown') return yield* invalid('Envelope needs a known pier side')
    if ((yield* required(mount.coordinateSystem, 'envelope coordinate frame')) !== 'topocentric')
      return yield* invalid('Envelope needs topocentric mount coordinates')
    const ra = (yield* required(mount.rightAscensionHours, 'envelope right ascension')) * 15
    const lst = (yield* required(mount.siderealTimeHours, 'envelope sidereal time')) * 15
    const declinationDegrees = yield* required(mount.declinationDegrees, 'envelope declination')
    const from: MountPose = { hourAngleDegrees: angularDelta(lst, ra), declinationDegrees, pierSide }
    const limit = snapshot.reading('MERIDIAN_LIMIT', numberElement('LIMIT'))
    const meridianLimit = limit.status === 'fresh' && Number.isFinite(limit.value) ? Math.max(0, limit.value) : 0
    const margin = blindTravel.margin(context.feedback.fix) / 60
    const refusal = typeof target === 'number'
      ? rateRefusal(envelope, from, target, meridianLimit)
      : gotoRefusal(envelope, from, { hourAngleDegrees: angularDelta(lst, target.rightAscensionDegrees), declinationDegrees: target.declinationDegrees }, meridianLimit, margin + reactionDegrees)

    if (refusal !== undefined) return yield* invalid(refusal)
    const near = watchRefusal(envelope, from, meridianLimit, margin,
      typeof target === 'number' ? -Math.sign(target) * reactionDegrees : -Math.sign(angularDelta(target.rightAscensionDegrees, ra)) * reactionDegrees,
      typeof target === 'number' ? 0 : Math.sign(target.declinationDegrees - declinationDegrees) * reactionDegrees)
    if (near !== undefined) return yield* invalid(`${near}; envelope margin ${margin.toFixed(3)}° plus reaction travel`)
  })

  const slew = (target: ParamsOf<'mount-slew'>, note: Note) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const mount = yield* idleAndUnparked(snapshot)
      const coordinates = coordinatesProperty(snapshot)

      if (!(yield* required(mount.canSlew, 'slew support')))
        return yield* new Failed({ reason: 'unsupported', message: 'The mount cannot slew' })
      if ((yield* required(mount.coordinateSystem, 'coordinate frame')) !== target.coordinateSystem)
        return yield* invalid(`Coordinates must be in the mount's frame (${coordinates.frame}); Cria never converts frames`)

      yield* checkEnvelope(snapshot, target)

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
      const envelopeStop: { reason?: string } = {}
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
        settle: guard(Effect.andThen(untilSettled(device, coordinates.name, () => true, timing.operationTimeoutMs), settled(command, tracking)), envelopeStop, target, command),
        stop: Effect.suspend(() => abort(tracking, undefined, envelopeStop.reason)),
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
      if (tracking && (yield* required(mount.parked, 'park state')))
        return yield* invalid('A parked mount cannot track')

      yield* switchConfirmed(
        device,
        'TELESCOPE_TRACK_STATE',
        tracking ? { TRACK_ON: true } : { TRACK_OFF: true },
        property => switchElement('TRACK_ON')(property) === tracking,
        timing,
      )

      return { tracking }
    })

  const park = (note: Note) => Effect.gen(function* () {
    const snapshot = yield* liveSnapshot(context)

    const mount = yield* idleAndUnparked(snapshot, true)

    if (!snapshot.property('TELESCOPE_PARK')) return yield* new Failed({ reason: 'unsupported', message: 'Park unsupported' })
    // A parked mount doesn't go Busy when asked to park again.
    if (yield* required(mount.parked, 'park state')) return {}

    const command = yield* beforeCommand(device)
    const tracking = yield* track(device, note, { kind: 'park', sentAt: command.sentAt }, command)

    yield* stoppable({
      command: `park on ${device.name}`,
      start: tracking.sentBy(startMotion(device, 'TELESCOPE_PARK', { PARK: true }, timing, { arrived: property => switchElement('PARK')(property) === true })),
      settle: Effect.andThen(untilSettled(device, 'TELESCOPE_PARK', property => switchElement('PARK')(property) === true, timing.operationTimeoutMs), settled(command, tracking)),
      stop: abort(tracking),
      stopWithin: stopWithinMs,
    })

    return {}
  }).pipe(Effect.scoped)

  const unpark = Effect.gen(function* () {
    const snapshot = yield* liveSnapshot(context)

    if (!snapshot.property('TELESCOPE_PARK')) return yield* new Failed({ reason: 'unsupported', message: 'Unpark unsupported' })

    yield* switchConfirmed(
      device,
      'TELESCOPE_PARK',
      { UNPARK: true },
      property => property.state !== 'Busy' && switchElement('PARK')(property) === false,
      timing,
    )

    return {}
  })

  const home = (note: Note) => Effect.gen(function* () {
    const snapshot = yield* liveSnapshot(context)

    yield* idleAndUnparked(snapshot)
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
   * the first session with Chris present. `rotate` also checks the observed RA
   * travel and ends uncertain if the mount moves the other way.
   */
  const axisMotion = (
    rateDegreesPerSecond: number,
    until: (travelled: Effect.Effect<number, Failed>) => Effect.Effect<void, Failed>,
    travelDegrees: (speed: number) => number,
    commanded: (rateDegreesPerSecond: number, sentAt: number) => MotionCommanded,
    note: Note,
  ) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const mount = yield* idleAndUnparked(snapshot)

      if (!(yield* required(mount.canMovePrimaryAxis, 'axis motion')))
        return yield* new Failed({ reason: 'unsupported', message: 'Axis motion unsupported' })

      const rates = yield* required(mount.primaryAxisRates, 'axis rates')
      const rate = advertisedRate(rates, Math.abs(rateDegreesPerSecond))

      if (!rate) {
        const offered = rates.map(candidate => `${candidate.degreesPerSecond.toPrecision(4)}`).join(', ')

        return yield* invalid(`The mount does not offer ${Math.abs(rateDegreesPerSecond)}°/s; it offers ${offered}°/s`)
      }

      yield* checkEnvelope(snapshot, Math.sign(rateDegreesPerSecond) * travelDegrees(rate.degreesPerSecond))

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
      const tracking = yield* track(device, note, commanded(Math.sign(rateDegreesPerSecond) * rate.degreesPerSecond, command.sentAt), command)
      const envelopeStop: { reason?: string } = {}
      const halt = Effect.asVoid(stopWith('TELESCOPE_MOTION_WE', { MOTION_EAST: false, MOTION_WEST: false }, 'halted', tracking))

      yield* stoppable({
        command: `axis motion on ${device.name}`,
        start: tracking.sentBy(startMotion(device, 'TELESCOPE_MOTION_WE', { [direction]: true }, timing, { refused: switchNotStarted(direction) })),
        // A normal finish stops the axis too; a second stop after a cancel is harmless.
        settle: guard(Effect.andThen(
          until(Effect.map(ra, now => angularDelta(now, start))),
          halt,
        ), envelopeStop, rateDegreesPerSecond, command),
        stop: Effect.suspend(() => envelopeStop.reason === undefined ? halt : abort(tracking, undefined, envelopeStop.reason)),
        stopWithin: stopWithinMs,
      })

      const end = yield* ra

      return { rightAscensionDegrees: end, rate: rate.name, travelledDegrees: angularDelta(end, start) }
    }).pipe(Effect.scoped)

  const moveAxis = (rateDegreesPerSecond: number, durationSeconds: number, note: Note) =>
    axisMotion(rateDegreesPerSecond, () => Effect.sleep(durationSeconds * 1000), speed => speed * durationSeconds, (rate, sentAt) => ({ kind: 'axis', sentAt, axis: 'ra', rateDegreesPerSecond: rate }), note)

  const rotate = (rateDegreesPerSecond: number, distanceDegrees: number, note: Note) => {
    const speed = Math.abs(rateDegreesPerSecond)
    const lead = (speed * motion.stopLatencyMs) / 1000
    const distance = Math.abs(distanceDegrees)

    if (Math.sign(rateDegreesPerSecond) !== Math.sign(distanceDegrees))
      return Effect.fail(invalid('The rate and the distance point in opposite directions'))
    if (lead > motion.maxLeadFraction * distance)
      return Effect.fail(
        invalid(
          `At ${speed.toFixed(3)}°/s the mount travels about ${lead.toFixed(2)}° after Cria sees the target (${motion.stopLatencyMs} ms), ` +
            `more than ${Math.round(motion.maxLeadFraction * 100)} % of the ${distance}° asked; use a slower rate or a longer rotate`,
        ),
      )

    return axisMotion(rateDegreesPerSecond, travelled =>
      Effect.gen(function* () {
        while (true) {
          const along = (yield* travelled) * Math.sign(distanceDegrees)

          if (along < -1) return yield* new Failed({ reason: 'rejected', message: 'The axis moved opposite to the requested RA travel' })
          if (along >= distance - lead) return
          yield* Effect.sleep('50 millis')
        }
      }).pipe(
        Effect.timeoutOption(Math.min(120, (distance / speed) * 2 + 2) * 1000),
        Effect.flatMap(
          Option.match({
            onSome: () => Effect.void,
            onNone: () => Effect.fail(new Failed({ reason: 'unavailable', message: 'The requested RA travel was not reached in time' })),
          }),
        ),
      ),
      () => distance,
      (rate, sentAt) => ({ kind: 'rotate', sentAt, axis: 'ra', rateDegreesPerSecond: rate, distanceDegrees }),
      note,
    )
  }

  return {
    watchTravel,
    observe: Effect.map(context.snapshot, snapshot => ({ kind: 'mount', readings: readings(snapshot) })),
    slew,
    setTracking,
    park,
    unpark,
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
function advertisedRate(rates: ReadonlyArray<AxisRate>, degreesPerSecond: number): AxisRate | undefined {
  return rates.find(rate => Math.abs(rate.degreesPerSecond - degreesPerSecond) <= degreesPerSecond * 0.01)
}
