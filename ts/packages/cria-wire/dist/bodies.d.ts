import { Schema } from 'effect';
export declare const protocolVersion = 6;
export declare const Health: Schema.Struct<{
    readonly status: Schema.Literal<"ok">;
    readonly protocolVersion: Schema.Literal<6>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
}>;
export declare const ConnectRequest: Schema.Struct<{
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly connected: Schema.Boolean;
}>;
export declare const ConnectResult: Schema.Struct<{
    readonly outcome: Schema.Literals<readonly ["confirmed", "failed", "uncertain"]>;
    readonly message: Schema.optionalKey<Schema.String>;
    readonly setup: Schema.optionalKey<Schema.String>;
}>;
export type ConnectRequest = typeof ConnectRequest.Type;
export type ConnectResult = typeof ConnectResult.Type;
//# sourceMappingURL=bodies.d.ts.map