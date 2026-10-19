/**
 * View: the recording on disk. One folder per Cria run:
 *
 *   manifest.json   written once at start; nothing rewrites it
 *   traffic.jsonl   one line per event, in the order Cria saw them
 *   blobs/          one file per BLOB payload, named by connection, ordinal and element index
 *
 * `traffic.jsonl` holds the whole story, so there is one writer of each fact: a
 * dropped stretch is a `gap` line, a settled Cria operation is an `op` line and
 * a clean shutdown is the `end` line. A
 * recording with no `end` line means Cria died.
 */
import { Schema } from 'effect'

const Count = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })))
const Milliseconds = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })))

/** Relative to the recording folder. The pattern keeps a damaged line from naming a path outside it. */
export const BlobPath = Schema.String.pipe(Schema.check(Schema.isPattern(/^blobs\/[0-9]+-[0-9]+-[0-9]+\.blob$/)))

export const blobPath = (conn: number, ordinal: number, index: number): string => `blobs/${conn}-${ordinal}-${index}.blob`

export const gapReasons = ['queue-full', 'low-disk', 'io-error'] as const

const timing = {
  /** Milliseconds since the recorder started, on a monotonic clock. */
  t: Milliseconds,
  /** Wall-clock epoch milliseconds. */
  at: Milliseconds,
}

/** One element on the wire. `n` counts messages per connection and direction from 0. */
export const MessageLine = Schema.Struct({
  k: Schema.Literal('msg'),
  ...timing,
  conn: Count,
  dir: Schema.Literals(['in', 'out']),
  n: Count,
  /** The wire text, each BLOB payload replaced by a self-closing `oneBLOB` that names its file in `ref`. */
  xml: Schema.String,
  blobs: Schema.optionalKey(Schema.Array(BlobPath)),
})

export const ConnectionLine = Schema.Struct({
  k: Schema.Literal('conn'),
  ...timing,
  conn: Count,
  status: Schema.Literals(['connected', 'closed']),
  error: Schema.optionalKey(Schema.String),
})

/**
 * Cria's ledger settled an operation. `operation` is the settled operation as
 * protocol 5 shows it (decode it with `@cria/wire`), so the packager gets Cria's
 * own times for it on the same clock as the INDI lines. Only what a join needs
 * is checked here; the rest passes through untouched.
 */
export const OperationLine = Schema.Struct({
  k: Schema.Literal('op'),
  ...timing,
  operation: Schema.StructWithRest(
    Schema.Struct({ id: Schema.String, requestId: Schema.String, state: Schema.Literal('settled') }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
})

/** Recording stopped here, for the rest of this run. Nothing but `end` follows. */
export const GapLine = Schema.Struct({
  k: Schema.Literal('gap'),
  ...timing,
  reason: Schema.Literals(gapReasons),
  dropped: Schema.Struct({ entries: Count, bytes: Count }),
})

export const EndLine = Schema.Struct({ k: Schema.Literal('end'), ...timing })

export const RecordingLine = Schema.Union([MessageLine, ConnectionLine, OperationLine, GapLine, EndLine])

export type MessageLine = typeof MessageLine.Type
export type ConnectionLine = typeof ConnectionLine.Type
export type OperationLine = typeof OperationLine.Type
export type SettledOperation = OperationLine['operation']
export type GapLine = typeof GapLine.Type
export type EndLine = typeof EndLine.Type
export type GapReason = GapLine['reason']
export type RecordingLine = typeof RecordingLine.Type

export const Manifest = Schema.Struct({
  format: Schema.Literal(1),
  /** The folder name. */
  recording: Schema.String,
  /** The Cria run (its `instanceId`), so a recording joins to Vela's records of the same run. */
  instanceId: Schema.String,
  startedAt: Milliseconds,
  indi: Schema.Struct({ host: Schema.String, port: Count }),
  /** Which INDI device is which, for replay and the packager. No serial ports and no site. */
  devices: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String, indiDevice: Schema.String })),
  limits: Schema.Struct({ queueBytes: Count, reserveBytes: Count }),
})

export type Manifest = typeof Manifest.Type

export const manifestFile = 'manifest.json'
export const trafficFile = 'traffic.jsonl'
export const blobsDirectory = 'blobs'
