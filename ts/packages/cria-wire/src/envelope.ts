import { Schema } from 'effect'
import { InstanceId } from './ids.js'
import { Timestamp } from './values.js'

const Degrees = (minimum: number, maximum: number) =>
  Schema.Number.pipe(Schema.check(Schema.isFinite(), Schema.isBetween({ minimum, maximum })))

export const KeepOutBand = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 256))),
  side: Schema.Literals(['normal', 'flipped']),
  minDeclinationDegrees: Degrees(-90, 90),
  maxDeclinationDegrees: Degrees(-90, 90),
  eastHourAngleDegrees: Schema.optionalKey(Degrees(-180, 180)),
  westHourAngleDegrees: Schema.optionalKey(Degrees(-180, 180)),
}).pipe(Schema.check(Schema.makeFilter(band =>
  (band.minDeclinationDegrees < band.maxDeclinationDegrees &&
    (band.eastHourAngleDegrees === undefined || band.westHourAngleDegrees === undefined || band.eastHourAngleDegrees < band.westHourAngleDegrees)) || 'band limits must be ordered',
)))

export const MountEnvelope = Schema.Struct({
  keepOut: Schema.Array(KeepOutBand).pipe(Schema.check(Schema.isBetweenLength(1, 128))),
  horizon: Schema.optionalKey(Schema.Array(Schema.Struct({ azimuthDegrees: Degrees(0, 360), altitudeDegrees: Degrees(-90, 90) }))),
  meridianLimitDegrees: Schema.optionalKey(Degrees(0, 180)),
})

export type MountEnvelope = typeof MountEnvelope.Type

export const AcceptedFix = Schema.Struct({
  capturedAt: Timestamp,
  rightAscensionDegrees: Degrees(0, 360),
  declinationDegrees: Degrees(-90, 90),
  coordinateSystem: Schema.Literal('j2000'),
  pointingErrorArcmin: Schema.NullOr(Degrees(0, 10800)),
  error: Schema.Struct({
    scaleError: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    hintOffsetDegrees: Schema.NullOr(Degrees(0, 180)),
  }),
})

export type AcceptedFix = typeof AcceptedFix.Type

export const EnvelopeRequest = Schema.Struct({ instanceId: InstanceId, envelope: MountEnvelope })
export const FixRequest = Schema.Struct({ instanceId: InstanceId, fix: AcceptedFix })
export const MountFeedback = Schema.Struct({
  envelope: Schema.NullOr(MountEnvelope),
  fix: Schema.NullOr(AcceptedFix),
})
export type MountFeedback = typeof MountFeedback.Type
