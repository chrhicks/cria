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
export declare const AcceptedFix: Schema.Struct<{
    readonly capturedAt: Schema.Number;
    readonly rightAscensionDegrees: Schema.Number;
    readonly declinationDegrees: Schema.Number;
    readonly coordinateSystem: Schema.Literal<"j2000">;
    readonly pointingErrorArcmin: Schema.NullOr<Schema.Number>;
    readonly error: Schema.Struct<{
        readonly scaleError: Schema.Number;
        readonly hintOffsetDegrees: Schema.NullOr<Schema.Number>;
    }>;
}>;
export type AcceptedFix = typeof AcceptedFix.Type;
export declare const EnvelopeRequest: Schema.Struct<{
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly envelope: Schema.Struct<{
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
}>;
export declare const FixRequest: Schema.Struct<{
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly fix: Schema.Struct<{
        readonly capturedAt: Schema.Number;
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
        readonly coordinateSystem: Schema.Literal<"j2000">;
        readonly pointingErrorArcmin: Schema.NullOr<Schema.Number>;
        readonly error: Schema.Struct<{
            readonly scaleError: Schema.Number;
            readonly hintOffsetDegrees: Schema.NullOr<Schema.Number>;
        }>;
    }>;
}>;
export declare const MountFeedback: Schema.Struct<{
    readonly envelope: Schema.NullOr<Schema.Struct<{
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
    }>>;
    readonly fix: Schema.NullOr<Schema.Struct<{
        readonly capturedAt: Schema.Number;
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
        readonly coordinateSystem: Schema.Literal<"j2000">;
        readonly pointingErrorArcmin: Schema.NullOr<Schema.Number>;
        readonly error: Schema.Struct<{
            readonly scaleError: Schema.Number;
            readonly hintOffsetDegrees: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}>;
export type MountFeedback = typeof MountFeedback.Type;
//# sourceMappingURL=envelope.d.ts.map