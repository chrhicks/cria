/**
 * View: the motion record on a settled mount operation. What Cria sent, where the mount was seen after the command and at rest, and how it came to rest. Positions are the mount's axis angles in degrees, in the frame of the
 * coordinates it reports; `travel` is `to` minus `from`, RA wrapped to (-180, 180].
 */
import { Schema } from 'effect';
export declare const MotionAxes: Schema.Struct<{
    readonly rightAscensionDegrees: Schema.Number;
    readonly declinationDegrees: Schema.Number;
}>;
export type MotionAxes = typeof MotionAxes.Type;
export declare const ForeignMotion: Schema.Struct<{
    readonly at: Schema.Number;
    readonly from: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
    }>;
    readonly to: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
    }>;
    /** Axis displacement after subtracting sidereal drift while tracking was off. */
    readonly unexplained: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
    }>;
}>;
export type ForeignMotion = typeof ForeignMotion.Type;
export declare const MotionCommanded: Schema.Union<readonly [Schema.Struct<{
    readonly sentAt: Schema.Number;
    readonly kind: Schema.Literal<"slew">;
    readonly target: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
    }>;
}>, Schema.Struct<{
    readonly sentAt: Schema.Number;
    readonly axis: Schema.Literal<"ra">;
    readonly rateDegreesPerSecond: Schema.Number;
    readonly kind: Schema.Literal<"axis">;
}>, Schema.Struct<{
    readonly sentAt: Schema.Number;
    readonly axis: Schema.Literal<"ra">;
    readonly rateDegreesPerSecond: Schema.Number;
    readonly kind: Schema.Literal<"rotate">;
    readonly distanceDegrees: Schema.Number;
}>, Schema.Struct<{
    readonly sentAt: Schema.Number;
    readonly kind: Schema.Literals<readonly ["home", "park", "stop"]>;
}>]>;
export type MotionCommanded = typeof MotionCommanded.Type;
/**
 * `arrived`: the mount stopped on its own at the end of the command. `halted`: Cria switched an axis motion off.
 * `aborted`: Cria sent an abort. `uncertain`: the readings never showed it stopped, so `to` and `at` are null.
 */
export declare const stoppedHows: readonly ['arrived', 'halted', 'aborted', 'uncertain'];
export declare const MotionRecord: Schema.Struct<{
    readonly commanded: Schema.Union<readonly [Schema.Struct<{
        readonly sentAt: Schema.Number;
        readonly kind: Schema.Literal<"slew">;
        readonly target: Schema.Struct<{
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
        }>;
    }>, Schema.Struct<{
        readonly sentAt: Schema.Number;
        readonly axis: Schema.Literal<"ra">;
        readonly rateDegreesPerSecond: Schema.Number;
        readonly kind: Schema.Literal<"axis">;
    }>, Schema.Struct<{
        readonly sentAt: Schema.Number;
        readonly axis: Schema.Literal<"ra">;
        readonly rateDegreesPerSecond: Schema.Number;
        readonly kind: Schema.Literal<"rotate">;
        readonly distanceDegrees: Schema.Number;
    }>, Schema.Struct<{
        readonly sentAt: Schema.Number;
        readonly kind: Schema.Literals<readonly ["home", "park", "stop"]>;
    }>]>;
    readonly observed: Schema.Struct<{
        /** The first position received after the command, if any. */
        readonly from: Schema.NullOr<Schema.Struct<{
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
        }>>;
        /** Where the readings show it stopped. */
        readonly to: Schema.NullOr<Schema.Struct<{
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
        }>>;
        readonly travel: Schema.NullOr<Schema.Struct<{
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
        }>>;
    }>;
    readonly stopped: Schema.Struct<{
        readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
        readonly reason: Schema.optionalKey<Schema.String>;
        /** When the one "stopped" rule (readings after the command show the position still) fired, epoch ms. */
        readonly at: Schema.NullOr<Schema.Number>;
    }>;
}>;
export type MotionRecord = typeof MotionRecord.Type;
//# sourceMappingURL=motion.d.ts.map