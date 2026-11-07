/**
 * View: the small bodies around operations (health and errors) and the
 * protocol version Vela checks.
 */
import { Schema } from 'effect'
import { InstanceId } from './ids.js'

export const protocolVersion = 5

export const Health = Schema.Struct({ status: Schema.Literal('ok'), protocolVersion: Schema.Literal(protocolVersion), instanceId: InstanceId, commandsEnabled: Schema.Boolean })

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
  'internal-error',
] as const

export type ErrorCode = (typeof errorCodes)[number]

export const ErrorBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.Literals(errorCodes), message: Schema.String }),
  instanceId: Schema.NullOr(InstanceId),
})

export type ErrorBody = typeof ErrorBody.Type

