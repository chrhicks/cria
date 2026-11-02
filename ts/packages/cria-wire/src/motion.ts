/**
 * View: the motion record on a settled mount operation. What Cria sent, where the mount was seen after the command and at rest, and how it came to rest. Positions are the mount's axis angles in degrees, in the frame of the
 * coordinates it reports; `travel` is `to` minus `from`, RA wrapped to (-180, 180].
 */
import { Schema } from 'effect'
import { Timestamp } from './values.js'

export const MotionAxes = Schema.Struct({ rightAscensionDegrees: Schema.Number, declinationDegrees: Schema.Number })

export type MotionAxes = typeof MotionAxes.Type

const sentAt = { sentAt: Timestamp }

/** The axis a rate move or rotate runs on is the mount's primary one, right ascension. */
const rate = { axis: Schema.Literal('ra'), rateDegreesPerSecond: Schema.Number }

export const MotionCommanded = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('slew'), ...sentAt, target: MotionAxes }),
  Schema.Struct({ kind: Schema.Literal('axis'), ...sentAt, ...rate }),
  Schema.Struct({ kind: Schema.Literal('rotate'), ...sentAt, ...rate, distanceDegrees: Schema.Number }),
  Schema.Struct({ kind: Schema.Literals(['home', 'park', 'stop']), ...sentAt }),
])

export type MotionCommanded = typeof MotionCommanded.Type

/**
 * `arrived`: the mount stopped on its own at the end of the command. `halted`: Cria switched an axis motion off.
 * `aborted`: Cria sent an abort. `uncertain`: the readings never showed it stopped, so `to` and `at` are null.
 */
export const stoppedHows = ['arrived', 'halted', 'aborted', 'uncertain'] as const

const restedOnlyIfStopped = Schema.makeFilter(
  (motion: { readonly observed: { readonly to: unknown; readonly travel: unknown }; readonly stopped: { readonly how: string; readonly at: unknown } }) =>
    motion.stopped.how === 'uncertain'
      ? (motion.observed.to === null && motion.observed.travel === null && motion.stopped.at === null) || 'an uncertain stop has no resting position or time'
      : (motion.observed.to !== null && motion.stopped.at !== null) || 'a stop has a resting position and a time',
)

export const MotionRecord = Schema.Struct({
  commanded: MotionCommanded,
  observed: Schema.Struct({
    /** The first position received after the command, if any. */
    from: Schema.NullOr(MotionAxes),
    /** Where the readings show it stopped. */
    to: Schema.NullOr(MotionAxes),
    travel: Schema.NullOr(MotionAxes),
  }),
  stopped: Schema.Struct({
    how: Schema.Literals(stoppedHows),
    /** When the one "stopped" rule (readings after the command show the position still) fired, epoch ms. */
    at: Schema.NullOr(Timestamp),
  }),
}).pipe(Schema.check(restedOnlyIfStopped))

export type MotionRecord = typeof MotionRecord.Type
