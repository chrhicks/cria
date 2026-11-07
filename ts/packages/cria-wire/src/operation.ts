/**
 * View: an operation and the request that admits it. An operation is
 * `waiting` (a halt queued behind the operation it stops; only halts wait),
 * `running` once started, and `settled` once its Outcome is known. Each state
 * carries only the fields it has. Vela matches `state`, then `outcome.kind`.
 */
import { Schema } from 'effect'
import { CommandSchema, HaltCommandSchema } from './command.js'
import { DeviceId, ImageId, InstanceId, OperationId, RequestId } from './ids.js'
import { MotionRecord } from './motion.js'
import { Json, Outcome, Timestamp } from './values.js'

const Name = Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 256)))

export const Image = Schema.Struct({
  id: ImageId,
  operationId: OperationId,
  instanceId: InstanceId,
  deviceId: DeviceId,
  cameraName: Name,
  width: Schema.Number,
  height: Schema.Number,
  exposureSeconds: Schema.Number,
  color: Schema.Literals(['mono', 'rggb', 'grbg', 'gbrg', 'bggr']),
  capturedAt: Timestamp,
  capturedAtSource: Schema.Literals(['camera', 'server-estimate']),
  retainedAt: Timestamp,
  sha256: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  original: Schema.Struct({
    mediaType: Schema.Literal('application/fits'),
    bytes: Schema.Number,
    url: Schema.String,
  }),
})

export type Image = typeof Image.Type

export const OperationResult = Schema.Struct({
  values: Schema.Record(Schema.String, Json),
  image: Schema.NullOr(Image),
})

export type OperationResult = typeof OperationResult.Type

/** The three fields that identify a request to a device, shared by `OperationRequest` and every operation state. */
export const requestIdentity = {
  instanceId: InstanceId,
  requestId: RequestId,
  deviceId: DeviceId,
}

/** What Vela sends: its identity for the request, then one command, flat. */
// Preserve each command's discriminant when a shared field is optional.
const struct = <F extends Schema.Struct.Fields>(fields: F): F extends unknown ? Schema.Struct<F> : never =>
  Schema.Struct(fields) as F extends unknown ? Schema.Struct<F> : never

export const OperationRequest = Schema.Union(CommandSchema.members.map(command => struct({ ...requestIdentity, ...command.fields })))

export type OperationRequest = typeof OperationRequest.Type

export const Progress = Schema.Struct({
  phase: Schema.Literals(['preparing', 'exposing', 'readout', 'retaining']),
  elapsedSeconds: Schema.NullOr(Schema.Number),
})

export type Progress = typeof Progress.Type

const accepted = { id: OperationId, ...requestIdentity, acceptedAt: Timestamp }

const settled = {
  ...accepted,
  state: Schema.Literal('settled'),
  startedAt: Timestamp,
  settledAt: Timestamp,
  outcome: Outcome(OperationResult),
  /** Present on a mount motion whose command was sent, whatever its outcome. */
  motion: Schema.optionalKey(MotionRecord),
}

export const Operation = Schema.Union([
  ...HaltCommandSchema.members.map(command => struct({ ...accepted, state: Schema.Literal('waiting'), ...command.fields })),
  ...CommandSchema.members.map(command =>
    struct({ ...accepted, state: Schema.Literal('running'), startedAt: Timestamp, progress: Progress, ...command.fields }),
  ),
  ...CommandSchema.members.map(command => struct({ ...settled, ...command.fields })),
])

export type Operation = typeof Operation.Type
