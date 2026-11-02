import { Schema } from 'effect';
export declare const KeepOutBand: Schema.Struct<{
    readonly name: Schema.String;
    readonly side: Schema.Literals<readonly ["normal", "flipped"]>;
    readonly minDeclinationDegrees: Schema.Number;
    readonly maxDeclinationDegrees: Schema.Number;
    readonly eastHourAngleDegrees: Schema.optionalKey<Schema.Number>;
    readonly westHourAngleDegrees: Schema.optionalKey<Schema.Number>;
}>;
export declare const MountEnvelope: Schema.Struct<{
    readonly keepOut: Schema.$Array<Schema.Struct<{
        readonly name: Schema.String;
        readonly side: Schema.Literals<readonly ["normal", "flipped"]>;
        readonly minDeclinationDegrees: Schema.Number;
        readonly maxDeclinationDegrees: Schema.Number;
        readonly eastHourAngleDegrees: Schema.optionalKey<Schema.Number>;
        readonly westHourAngleDegrees: Schema.optionalKey<Schema.Number>;
    }>>;
    readonly horizon: Schema.optionalKey<Schema.$Array<Schema.Struct<{
        readonly azimuthDegrees: Schema.Number;
        readonly altitudeDegrees: Schema.Number;
    }>>>;
    readonly meridianLimitDegrees: Schema.optionalKey<Schema.Number>;
}>;
export type MountEnvelope = typeof MountEnvelope.Type;
//# sourceMappingURL=envelope.d.ts.map