/**
 * View: the two primitives as wire shapes. Reading and Outcome are the same
 * unions as in @cria/primitives, with epoch-millisecond times; the closed
 * reason lists are imported from there, so they can't drift.
 */
import { Schema } from 'effect'
import { failedReasons, uncertainReasons, unavailableReasons } from '@cria/primitives'

export const Timestamp = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)))

export const Json = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])

export function Reading<S extends Schema.Top>(value: S) {
  return Schema.Union([
    Schema.Struct({ status: Schema.Literal('fresh'), value, observedAt: Timestamp }),
    Schema.Struct({ status: Schema.Literal('stale'), value, observedAt: Timestamp }),
    Schema.Struct({
      status: Schema.Literal('unavailable'),
      reason: Schema.Literals(unavailableReasons),
      message: Schema.optionalKey(Schema.String),
    }),
  ])
}

export function Outcome<S extends Schema.Top>(value: S) {
  return Schema.Union([
    Schema.Struct({ kind: Schema.Literal('confirmed'), value }),
    Schema.Struct({ kind: Schema.Literal('failed'), reason: Schema.Literals(failedReasons), message: Schema.String }),
    Schema.Struct({ kind: Schema.Literal('stopped') }),
    Schema.Struct({ kind: Schema.Literal('uncertain'), reason: Schema.Literals(uncertainReasons), message: Schema.String }),
  ])
}
