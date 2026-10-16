/**
 * View: the two primitives as wire shapes. Reading and Outcome are the same
 * unions as in @cria/primitives, with epoch-millisecond times; the closed
 * reason lists are imported from there, so they can't drift.
 */
import { Schema } from 'effect';
export declare const Timestamp: Schema.Number;
export declare const Json: Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>;
export declare function Reading<S extends Schema.Top>(value: S): Schema.Union<readonly [Schema.Struct<{
    readonly status: Schema.Literal<"fresh">;
    readonly value: S;
    readonly observedAt: Schema.Number;
}>, Schema.Struct<{
    readonly status: Schema.Literal<"stale">;
    readonly value: S;
    readonly observedAt: Schema.Number;
}>, Schema.Struct<{
    readonly status: Schema.Literal<"unavailable">;
    readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
    readonly message: Schema.optionalKey<Schema.String>;
}>]>;
export declare function Outcome<S extends Schema.Top>(value: S): Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literal<"confirmed">;
    readonly value: S;
}>, Schema.Struct<{
    readonly kind: Schema.Literal<"failed">;
    readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
    readonly message: Schema.String;
}>, Schema.Struct<{
    readonly kind: Schema.Literal<"stopped">;
}>, Schema.Struct<{
    readonly kind: Schema.Literal<"uncertain">;
    readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
    readonly message: Schema.String;
}>]>;
//# sourceMappingURL=values.d.ts.map