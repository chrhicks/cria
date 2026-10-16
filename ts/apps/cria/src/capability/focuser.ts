/**
 * Capability: focuser. An INDI absolute focuser seen through the disciplines:
 * a move is `stoppable` (abort on cancel, confirm it stopped), halt is
 * `writeOnce` + `confirm`. A move is checked against the driver's range and
 * the configured travel window before anything is sent.
 */
import { Effect } from 'effect'
import { Failed, Reading, Uncertain, stoppable, type Ending } from '@cria/primitives'
import { confirmProperty, sendOnce, startMotion, untilSettled } from './commands.js'
import { invalid, liveSnapshot, required, type CapabilityContext } from './context.js'
import { limitElement, numberElement, type DeviceSnapshot } from './fields.js'
import type { FocuserTravel } from '../config.js'
import type { DeviceBody, ParamsOf, ReadingsOf } from '@cria/wire'

export interface Focuser {
  readonly observe: Effect.Effect<DeviceBody<'focuser'>>
  readonly move: (move: ParamsOf<'focuser-move'>) => Effect.Effect<{ position: number }, Ending>
  readonly halt: Effect.Effect<{ position: number }, Failed | Uncertain>
}

const position = 'ABS_FOCUS_POSITION'
const positionValue = numberElement('FOCUS_ABSOLUTE_POSITION')

/**
 * The driver's top: the position's own maximum, or FOCUS_MAX if lower.
 * FOCUS_MAX is a user setting that can sit past what the position accepts
 * (errai's EAF: 100000 against 60000). The limits come from the definition, so
 * an Alert on the position (a refused move) does not make them old.
 */
function driverMax(snapshot: DeviceSnapshot) {
  const positionMax = snapshot.reading(position, limitElement(['FOCUS_ABSOLUTE_POSITION'], 'max'), { alertMeansStale: false })

  // Only a defined FOCUS_MAX narrows it: a focuser without one would otherwise read not-read until the definitions settle.
  return snapshot.property('FOCUS_MAX')
    ? Reading.both(snapshot.reading('FOCUS_MAX', numberElement('FOCUS_MAX_VALUE')), positionMax, Math.min)
    : positionMax
}

function readings(snapshot: DeviceSnapshot, travel: FocuserTravel | undefined): ReadingsOf<'focuser'> {
  const read = snapshot.reading

  return {
    connected: snapshot.connected,
    name: snapshot.name,
    // Alert on the position means the last move failed; the position is still reported, and the focuser can still move.
    position: read(position, positionValue, { alertMeansStale: false }),
    moving: read(position, property => property.state === 'Busy', { alertMeansStale: false }),
    temperatureC: read('FOCUS_TEMPERATURE', numberElement('TEMPERATURE')),
    absolute: read(position, () => true, { alertMeansStale: false }),
    // The usable window, which Vela's autofocus searches: the driver's range narrowed by the travel window.
    minStep: Reading.map(read(position, limitElement(['FOCUS_ABSOLUTE_POSITION'], 'min'), { alertMeansStale: false }), min => Math.max(min, travel?.min ?? min)),
    maxStep: Reading.map(driverMax(snapshot), max => Math.min(max, travel?.max ?? max)),
  }
}

/**
 * Why the travel window refuses a target, or undefined. Both ends are allowed.
 * A focuser already outside the window (moved by hand or by another client)
 * may move back toward it, so it can be recovered, but not further away or
 * past its far end.
 */
function travelRefusal(travel: FocuserTravel, at: number, target: number): string | undefined {
  if (target >= travel.min && target <= travel.max) return undefined
  if ((at < travel.min && target >= at && target < travel.min) || (at > travel.max && target <= at && target > travel.max)) return undefined

  const outside = `Focuser target ${target} is outside the travel window ${travel.min}..${travel.max}`

  return at < travel.min || at > travel.max ? `${outside} and the focuser is at ${at}: only a move toward the window is allowed` : outside
}

export function makeFocuser(context: CapabilityContext, travel?: FocuserTravel): Focuser {
  const { device, timing } = context

  const readPosition = Effect.gen(function* () {
    const snapshot = yield* context.snapshot

    return yield* required(readings(snapshot, travel).position, 'focuser position')
  })

  const abort = Effect.gen(function* () {
    yield* sendOnce(device, 'FOCUS_ABORT_MOTION', { ABORT: true }, timing)
    yield* confirmProperty(device, position, property => property.state !== 'Busy', 15_000)
  })

  const move = (move: ParamsOf<'focuser-move'>) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const focuser = readings(snapshot, travel)

      if (!(yield* required(focuser.absolute, 'absolute positioning')) || (yield* required(focuser.moving, 'focuser motion')))
        return yield* new Failed({ reason: 'busy', message: 'An absolute, idle focuser is required' })

      const at = yield* required(focuser.position, 'focuser position')

      if (move.position >= (yield* required(driverMax(snapshot), 'focuser travel'))) return yield* invalid('Focuser target approaches the mechanical limit')
      const refusal = travel && travelRefusal(travel, at, move.position)

      if (refusal) return yield* invalid(refusal)
      if (at === move.position) return { position: move.position }

      const arrived = yield* stoppable({
        command: `focuser move on ${device.name}`,
        start: startMotion(device, position, { FOCUS_ABSOLUTE_POSITION: move.position }, timing, {
          arrived: property => positionValue(property) === move.position,
        }),
        settle: untilSettled(device, position, () => true, timing.operationTimeoutMs),
        stop: abort,
        stopWithin: 20_000,
      })
      const reached = positionValue(arrived)

      if (reached !== move.position)
        // It moved, just not to the target: not "failed" (which means nothing happened).
        return yield* new Uncertain({ reason: 'not-confirmed', message: `Focuser stopped at ${reached}, short of ${move.position}` })

      return { position: reached }
    })

  const halt = Effect.gen(function* () {
    yield* abort

    return { position: yield* readPosition }
  })

  return {
    observe: Effect.map(context.snapshot, snapshot => ({ kind: 'focuser', readings: readings(snapshot, travel) })),
    move,
    halt,
  }
}
