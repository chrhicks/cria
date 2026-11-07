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
    readonly kind: Schema.Literals<readonly ["home", "stop"]>;
}>]>;
export type MotionCommanded = typeof MotionCommanded.Type;
/**
 * `arrived`: the mount stopped on its own at the end of the command. `halted`: Cria switched an axis motion off.
 * `aborted`: Cria sent an abort. `uncertain`: the readings never showed it stopped, so `to` and `at` are null.
 */
export declare const stoppedHows: readonly ['arrived', 'halted', 'aborted', 'uncertain'];
export declare const MotionLeg: Schema.Struct<{
    commanded: Schema.Union<readonly [Schema.Struct<{
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
        readonly kind: Schema.Literals<readonly ["home", "stop"]>;
    }>]>;
    observed: Schema.Struct<{
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
    stopped: Schema.Struct<{
        readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
        /** When the one "stopped" rule (readings after the command show the position still) fired, epoch ms. */
        readonly at: Schema.NullOr<Schema.Number>;
    }>;
    /** How far RA travelled after an axis motion was switched off, in the direction of travel. */
    coastDegrees: Schema.optionalKey<Schema.Number>;
}>;
export type MotionLeg = typeof MotionLeg.Type;
/** A rotate's record also lists the axis motions it ran, in order, as `legs`. */
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
        readonly kind: Schema.Literals<readonly ["home", "stop"]>;
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
        /** When the one "stopped" rule (readings after the command show the position still) fired, epoch ms. */
        readonly at: Schema.NullOr<Schema.Number>;
    }>;
    readonly coastDegrees: Schema.optionalKey<Schema.Number>;
    readonly legs: Schema.optionalKey<Schema.$Array<Schema.Struct<{
        commanded: Schema.Union<readonly [Schema.Struct<{
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
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        observed: Schema.Struct<{
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
        stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            /** When the one "stopped" rule (readings after the command show the position still) fired, epoch ms. */
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
        /** How far RA travelled after an axis motion was switched off, in the direction of travel. */
        coastDegrees: Schema.optionalKey<Schema.Number>;
    }>>>;
}>;
export type MotionRecord = typeof MotionRecord.Type;
//# sourceMappingURL=motion.d.ts.map