/**
 * The one definition of "the mount has stopped": readings that arrived after the command show its position no
 * longer changing. Every motion path decides this here: a rate move's halt, an abort of a slew, park or home,
 * and the settle of a goto or home.
 *
 * The state of a property does not say it. The AM5 sets its coordinates Idle the moment it takes an abort and then
 * coasts for seconds, a goto ends Ok, a rate move with tracking on never reports Idle, and the driver leaves
 * TELESCOPE_HOME Busy after a home it has stopped. And INDI publishes a position only when it changes, so a quiet
 * mirror says nothing: the position is read again from the driver (`getProperties`), `positionReadMs` apart.
 *
 * A reading counts only if it arrived after the command was sent. A reply in the first window after the command that
 * repeats the position the mirror held when it went out may be the driver's cache of its last poll, and is dropped:
 * it cannot show the mount stopped. After that window the driver has polled again, and the same position is where
 * the mount is. A mount that was already still takes one more read to confirm.
 */
import { Clock, Effect, Option } from 'effect'
import { confirm, type Uncertain } from '@cria/primitives'
import type { IndiDevice, Property } from '@cria/indi'
import type { MountMotionSettings } from '../config.js'
import { numberElement } from './fields.js'

/** Axis angles in degrees. */
export interface Position {
  readonly ra: number
  readonly dec: number
}

export interface Reading extends Position {
  /** When Cria received it (epoch ms). */
  readonly at: number
}

export interface Command {
  /** When Cria began sending the command (epoch ms). */
  readonly sentAt: number
  /** The position the mirror held at that moment, if it held one. */
  readonly before?: Position
}

export interface Rule {
  readonly windowMs: number
  readonly stationaryDegrees: number
}

/** The signed difference of two angles in degrees, in (-180, 180]. */
export function angularDelta(current: number, origin: number): number {
  return ((current - origin + 540) % 360) - 180
}

export function positionOf(property: Property): Position {
  return { ra: (numberElement('RA')(property) ?? Number.NaN) * 15, dec: numberElement('DEC')(property) ?? Number.NaN }
}

const within = (a: Position, b: Position, degrees: number) => Math.abs(angularDelta(a.ra, b.ra)) <= degrees && Math.abs(a.dec - b.dec) <= degrees

const sameValue = (a: Position, b: Position) => within(a, b, 1e-9)

/**
 * The position the mount stopped at, or undefined while the readings do not show it. It has stopped when the newest
 * reading and an earlier one at least `windowMs` before it, with every reading between them, differ by at most
 * `stationaryDegrees` on each axis. Each axis, not the angle on the sky: at the pole a turning RA axis barely moves
 * the pointing.
 *
 * Only readings that arrived after `command.sentAt` count, and a reading equal to the position the mirror held at the
 * command, arriving within `windowMs` of it, is a repeat of an old value and is dropped.
 */
export function stoppedAt(readings: ReadonlyArray<Reading>, command: Command, rule: Rule): Position | undefined {
  const repeatsOld = (reading: Reading) => command.before !== undefined && reading.at - command.sentAt < rule.windowMs && sameValue(reading, command.before)
  const counted = readings.filter(reading => reading.at > command.sentAt && !repeatsOld(reading))
  const newest = counted.at(-1)

  if (newest === undefined) return undefined
  const anchor = counted.map(reading => newest.at - reading.at >= rule.windowMs).lastIndexOf(true)

  if (anchor < 0) return undefined

  return counted.slice(anchor).every(reading => within(reading, newest, rule.stationaryDegrees)) ? { ra: newest.ra, dec: newest.dec } : undefined
}

function coordinates(device: IndiDevice) {
  return Effect.gen(function* () {
    return Option.isSome(yield* device.property('EQUATORIAL_EOD_COORD')) ? 'EQUATORIAL_EOD_COORD' : 'EQUATORIAL_COORD'
  })
}

/** The command's context: the clock and the position the mirror holds, taken just before the command is sent. */
export function beforeCommand(device: IndiDevice) {
  return Effect.gen(function* () {
    const property = Option.getOrUndefined(yield* device.property(yield* coordinates(device)))
    const sentAt = yield* Clock.currentTimeMillis

    return { sentAt, ...(property === undefined ? {} : { before: positionOf(property) }) } satisfies Command
  })
}

/**
 * Waits until the readings of the mount's position, each a definition the driver sends again, show it stopped
 * (`stoppedAt`). Reads, not pushed updates: a still mount publishes nothing, and the same update read twice proves
 * nothing. The reads are `positionReadMs` apart, longer than indi_lx200am5's 1 s poll of the mount, so two of them
 * straddle at least one poll. Not stopped within `withinMs` ends uncertain.
 */
export function confirmStopped(device: IndiDevice, motion: MountMotionSettings, command: Command, withinMs: number): Effect.Effect<Position, Uncertain> {
  return Effect.gen(function* () {
    const name = yield* coordinates(device)
    const readings: Reading[] = []
    // Timers can fire a few ms early, so two reads one period apart can arrive a hair under it.
    const rule = { windowMs: motion.positionReadMs - 20, stationaryDegrees: motion.stationaryDegrees }

    const read = Effect.map(Effect.timeout(device.read(name), motion.positionReadMs), property => {
      readings.push({ ...positionOf(property), at: property.receivedAt })

      return stoppedAt(readings, command, rule)
    })

    return yield* confirm({ command: `stop on ${device.name}`, read, holds: position => position !== undefined, within: withinMs, every: motion.positionReadMs }).pipe(
      Effect.map(position => position!),
    )
  })
}
