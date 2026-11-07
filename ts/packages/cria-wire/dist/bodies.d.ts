/**
 * View: the small bodies around operations (health and errors) and the
 * protocol version Vela checks.
 */
import { Schema } from 'effect';
export declare const protocolVersion = 5;
export declare const Health: Schema.Struct<{
    readonly status: Schema.Literal<"ok">;
    readonly protocolVersion: Schema.Literal<5>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly commandsEnabled: Schema.Boolean;
}>;
export declare const errorCodes: readonly ['request-error', 'origin-rejected', 'commands-disabled', 'not-found', 'request-conflict', 'instance-changed', 'device-busy', 'result-expired', 'image-gone', 'request-too-large', 'internal-error'];
export type ErrorCode = (typeof errorCodes)[number];
export declare const ErrorBody: Schema.Struct<{
    readonly error: Schema.Struct<{
        readonly code: Schema.Literals<readonly ["request-error", "origin-rejected", "commands-disabled", "not-found", "request-conflict", "instance-changed", "device-busy", "result-expired", "image-gone", "request-too-large", "internal-error"]>;
        readonly message: Schema.String;
    }>;
    readonly instanceId: Schema.NullOr<Schema.brand<Schema.String, "InstanceId">>;
}>;
export type ErrorBody = typeof ErrorBody.Type;
//# sourceMappingURL=bodies.d.ts.map