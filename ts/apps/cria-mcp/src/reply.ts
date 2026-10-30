import { Effect, Schema } from 'effect'
import { ErrorBody } from '@cria/wire'
import { CriaRefused, lostReasons, type CriaError } from './cria.js'

/**
 * What every tool returns. `body` stays `Schema.Unknown` here because the wire's
 * `State` alone inlines to 210 KB of JSON Schema; the body was already decoded
 * strictly with the wire before it got here.
 */
export const Reply = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('answered'), body: Schema.Unknown }),
  Schema.Struct({ kind: Schema.Literal('refused'), status: Schema.Number, body: ErrorBody }),
  Schema.Struct({ kind: Schema.Literal('lost'), route: Schema.String, why: Schema.Literals(lostReasons), message: Schema.String }),
])
export type Reply = typeof Reply.Type

const failed = (error: CriaError): Reply =>
  error instanceof CriaRefused
    ? { kind: 'refused', status: error.status, body: error.body }
    : { kind: 'lost', route: error.route, why: error.why, message: error.message }

export const toReply = <A, R>(effect: Effect.Effect<A, CriaError, R>): Effect.Effect<Reply, never, R> =>
  Effect.match(effect, { onSuccess: (body): Reply => ({ kind: 'answered', body }), onFailure: failed })
