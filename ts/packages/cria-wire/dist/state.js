/**
 * View: the state snapshot (GET /v2/state, and every SSE `state` event), the
 * small bodies around it, and the protocol version Vela checks.
 */
import { Schema } from 'effect';
import { Device } from './device.js';
import { InstanceId } from './ids.js';
import { Operation } from './operation.js';
import { Timestamp } from './values.js';
export const protocolVersion = 5;
export const State = Schema.Struct({
    protocolVersion: Schema.Literal(protocolVersion),
    instanceId: InstanceId,
    sequence: Schema.Number,
    generatedAt: Timestamp,
    commandsEnabled: Schema.Boolean,
    devices: Schema.Array(Device),
    operations: Schema.Array(Operation),
});
export const Health = Schema.Struct({ status: Schema.Literal('ok'), protocolVersion: Schema.Literal(protocolVersion) });
export const errorCodes = [
    'request-error',
    'origin-rejected',
    'commands-disabled',
    'not-found',
    'request-conflict',
    'instance-changed',
    'device-busy',
    'result-expired',
    'image-gone',
    'request-too-large',
    'too-many-subscribers',
    'internal-error',
];
export const ErrorBody = Schema.Struct({
    error: Schema.Struct({ code: Schema.Literals(errorCodes), message: Schema.String }),
    instanceId: Schema.NullOr(InstanceId),
});
//# sourceMappingURL=state.js.map