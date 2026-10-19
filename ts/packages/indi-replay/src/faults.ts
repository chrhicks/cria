/**
 * Faults a scenario adds to a replay. A fault starts when the replay reserves
 * (`before-exposure`, the default) or delivers (`before-blob`) the source frame
 * `at`, counted from 0 in the recording. How long it lasts is real time.
 */
import { Schema } from 'effect'
import type { Value } from '@cria/fake-indi'

export type FaultPhase = 'before-exposure' | 'before-blob'

export type Fault = { readonly at: number; readonly phase?: FaultPhase } & (
  /** Frames `at` to `at + count - 1` arrive with every pixel equal: the stars are gone. */
  | { readonly kind: 'blank'; readonly count: number }
  /** A device property takes these values and keeps them: later source updates to it are ignored. */
  | { readonly kind: 'set'; readonly device: string; readonly property: string; readonly values: Readonly<Record<string, Value>>; readonly state?: 'Idle' | 'Ok' | 'Busy' | 'Alert' }
  /** The driver for `device` sends nothing and answers no getProperties for `forMs`. */
  | { readonly kind: 'silent'; readonly device: string; readonly forMs: number }
  /** Every connection is closed, and new ones are refused for `forMs` (default 0: Cria may reconnect at once). */
  | { readonly kind: 'disconnect'; readonly forMs?: number }
)

const Frame = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })))
const Milliseconds = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 86_400_000 })))
const at = { at: Frame, phase: Schema.optionalKey(Schema.Literals(['before-exposure', 'before-blob'])) }

const FaultSchema = Schema.Union([
  Schema.Struct({ ...at, kind: Schema.Literal('blank'), count: Frame.pipe(Schema.check(Schema.isGreaterThan(0))) }),
  Schema.Struct({
    ...at,
    kind: Schema.Literal('set'),
    device: Schema.String,
    property: Schema.String,
    values: Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.Boolean, Schema.String])),
    state: Schema.optionalKey(Schema.Literals(['Idle', 'Ok', 'Busy', 'Alert'])),
  }),
  Schema.Struct({ ...at, kind: Schema.Literal('silent'), device: Schema.String, forMs: Milliseconds }),
  Schema.Struct({ ...at, kind: Schema.Literal('disconnect'), forMs: Schema.optionalKey(Milliseconds) }),
])

/** Faults from JSON, refusing unknown keys, kinds and out-of-range numbers. */
export const decodeFaults = (json: unknown): ReadonlyArray<Fault> =>
  Schema.decodeUnknownSync(Schema.Array(FaultSchema))(json, { onExcessProperty: 'error' })
