/**
 * View: an operation and the request that admits it. An operation is
 * `waiting` (a halt queued behind the operation it stops; only halts wait),
 * `running` once started, and `settled` once its Outcome is known. Each state
 * carries only the fields it has. Vela matches `state`, then `outcome.kind`.
 */
import { Schema } from 'effect';
import { CommandSchema, HaltCommandSchema } from './command.js';
import { BindingId, DeviceId, FailureDomain, ImageId, InstanceId, OperationId, RequestId } from './ids.js';
import { Json, Outcome, Timestamp } from './values.js';
const Name = Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 256)));
export const Image = Schema.Struct({
    id: ImageId,
    operationId: OperationId,
    instanceId: InstanceId,
    deviceId: DeviceId,
    cameraName: Name,
    bindingId: BindingId,
    width: Schema.Number,
    height: Schema.Number,
    binX: Schema.Number,
    binY: Schema.Number,
    startX: Schema.Number,
    startY: Schema.Number,
    exposureSeconds: Schema.Number,
    color: Schema.Literals(['mono', 'rggb', 'grbg', 'gbrg', 'bggr']),
    capturedAt: Timestamp,
    capturedAtSource: Schema.Literals(['camera', 'server-estimate']),
    retainedAt: Timestamp,
    sha256: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
    original: Schema.Struct({
        mediaType: Schema.Literal('application/imagebytes'),
        bytes: Schema.Number,
        url: Schema.String,
    }),
});
export const OperationResult = Schema.Struct({
    values: Schema.Record(Schema.String, Json),
    image: Schema.NullOr(Image),
});
const identity = {
    instanceId: InstanceId,
    requestId: RequestId,
    deviceId: DeviceId,
    bindingId: BindingId,
    expectedName: Name,
};
/** What Vela sends: its identity for the request, then one command, flat. */
export const OperationRequest = Schema.Union(CommandSchema.members.map(command => Schema.Struct({ ...identity, ...command.fields })));
export const Progress = Schema.Struct({
    phase: Schema.Literals(['preparing', 'exposing', 'readout', 'retaining']),
    elapsedSeconds: Schema.NullOr(Schema.Number),
});
const accepted = { id: OperationId, ...identity, failureDomain: FailureDomain, acceptedAt: Timestamp };
const settled = {
    ...accepted,
    state: Schema.Literal('settled'),
    startedAt: Timestamp,
    settledAt: Timestamp,
    outcome: Outcome(OperationResult),
    /** Set once a person recovered the device this uncertain operation quarantined. */
    recovery: Schema.NullOr(Schema.Struct({ at: Timestamp, note: Schema.String })),
};
const recoveredOnlyIfUncertain = Schema.makeFilter((operation) => operation.recovery === null || operation.outcome.kind === 'uncertain' || 'only an uncertain operation is recovered');
export const Operation = Schema.Union([
    ...HaltCommandSchema.members.map(command => Schema.Struct({ ...accepted, state: Schema.Literal('waiting'), ...command.fields })),
    ...CommandSchema.members.map(command => Schema.Struct({ ...accepted, state: Schema.Literal('running'), startedAt: Timestamp, progress: Progress, ...command.fields })),
    ...CommandSchema.members.map(command => Schema.Struct({ ...settled, ...command.fields }).pipe(Schema.check(recoveredOnlyIfUncertain))),
]);
//# sourceMappingURL=operation.js.map