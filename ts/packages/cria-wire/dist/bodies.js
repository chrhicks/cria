import { Schema } from 'effect';
import { DeviceId, InstanceId } from './ids.js';
export const protocolVersion = 6;
export const Health = Schema.Struct({ status: Schema.Literal('ok'), protocolVersion: Schema.Literal(protocolVersion), instanceId: InstanceId });
export const ConnectRequest = Schema.Struct({ deviceId: DeviceId, connected: Schema.Boolean });
export const ConnectResult = Schema.Struct({
    outcome: Schema.Literals(['confirmed', 'failed', 'uncertain']),
    message: Schema.optionalKey(Schema.String),
    setup: Schema.optionalKey(Schema.String),
});
//# sourceMappingURL=bodies.js.map