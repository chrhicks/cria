import { Schema } from 'effect'

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
