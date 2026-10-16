/**
 * View: the state snapshot (GET /v2/state, and every SSE `state` event), the
 * small bodies around it, and the protocol version Vela checks.
 */
import { Schema } from 'effect'
import { Device } from './device.js'
import { BindingId, InstanceId } from './ids.js'
import { Operation } from './operation.js'
import { Timestamp } from './values.js'

export const protocolVersion = 5

export const State = Schema.Struct({
  protocolVersion: Schema.Literal(protocolVersion),
  instanceId: InstanceId,
  sequence: Schema.Number,
  generatedAt: Timestamp,
  commandsEnabled: Schema.Boolean,
  devices: Schema.Array(Device),
  operations: Schema.Array(Operation),
})

export type State = typeof State.Type

export const Health = Schema.Struct({ status: Schema.Literal('ok'), protocolVersion: Schema.Literal(protocolVersion) })

export const errorCodes = [
  'request-error',
  'unauthorized',
  'origin-rejected',
  'commands-disabled',
  'not-found',
  'request-conflict',
  'instance-changed',
  'binding-changed',
  'device-blocked',
  'device-busy',
  'result-expired',
  'image-gone',
  'request-too-large',
  'too-many-subscribers',
  'internal-error',
] as const

export type ErrorCode = (typeof errorCodes)[number]

export const ErrorBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.Literals(errorCodes), message: Schema.String }),
  instanceId: Schema.NullOr(InstanceId),
})

export type ErrorBody = typeof ErrorBody.Type

export const RecoveryRequest = Schema.Struct({
  instanceId: InstanceId,
  bindingId: BindingId,
  externalRecoveryConfirmed: Schema.Literal(true),
  note: Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 1024))),
})

export type RecoveryRequest = typeof RecoveryRequest.Type
