/**
 * What the planner needs, read from the two places that hold it: the staged recording (capture operations,
 * image messages, blob files) and Vela's own records, read-only (`<vela>/traces/frames.jsonl` and
 * `autofocus.jsonl`). Both boundaries decode strictly: a line that does not fit is refused, never skipped,
 * because a skipped Vela record is a saved frame the plan would prune.
 */
import { open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Result, Schema } from 'effect'
import { readFitsHeader } from '@cria/fits'
import { blobsDirectory, readManifest, readRecording } from '@cria/recording'
import { ArchiveError } from './files.js'
import type { AutofocusSample, Capture, Delivery, VelaFrame } from './plan.js'

const CaptureOperation = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal('capture'),
  expectedName: Schema.String,
  startedAt: Schema.Number,
  settledAt: Schema.Number,
  outcome: Schema.Struct({
    kind: Schema.String,
    value: Schema.optionalKey(
      Schema.Struct({
        image: Schema.NullOr(Schema.Struct({ id: Schema.String, capturedAt: Schema.Number, capturedAtSource: Schema.String, exposureSeconds: Schema.Number })),
      }),
    ),
  }),
})

const decodeCapture = Schema.decodeUnknownResult(CaptureOperation)

const headerBytes = 64 * 1024

async function headerOf(path: string): Promise<{ exposureSeconds?: number; observedAt?: number }> {
  const file = await open(path, 'r')
  const head = Buffer.alloc(headerBytes)
  const { bytesRead } = await file.read(head, 0, headerBytes, 0).finally(() => file.close())
  const header = readFitsHeader(head.subarray(0, bytesRead)).cards
  const exposure = Number(header.get('EXPTIME'))
  const observed = Date.parse(`${header.get('DATE-OBS') ?? ''}Z`)

  return { ...(Number.isFinite(exposure) ? { exposureSeconds: exposure } : {}), ...(Number.isFinite(observed) ? { observedAt: observed } : {}) }
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

/** The device a BLOB vector is from: the `device` attribute of its opening tag. */
const deviceOf = (xml: string): string | undefined => /<\w+\b[^>]*?\sdevice="([^"]*)"/.exec(xml)?.[1]?.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => entities[entity]!)

export interface RecordingEvidence {
  readonly captures: ReadonlyArray<Capture>
  readonly deliveries: ReadonlyArray<Delivery>
  readonly blobFiles: ReadonlyArray<string>
  readonly window: { readonly from: number; readonly to: number }
}

export async function readRecordingEvidence(dir: string): Promise<RecordingEvidence> {
  const manifest = await readManifest(dir)
  const captures: Capture[] = []
  const deliveries: Delivery[] = []
  let to = manifest.startedAt

  for await (const line of readRecording(dir)) {
    to = Math.max(to, line.at)

    if (line.k === 'op' && line.operation['kind'] === 'capture') {
      const decoded = decodeCapture(line.operation)

      if (Result.isFailure(decoded)) throw new ArchiveError(`an op line for ${line.operation.id} does not decode: ${String(decoded.failure)}`)

      const { id, expectedName, startedAt, settledAt, outcome } = decoded.success
      const image = outcome.value?.image

      if (image) captures.push({ operationId: id, imageId: image.id, device: expectedName, startedAt, settledAt, capturedAt: image.capturedAt, capturedAtSource: image.capturedAtSource, exposureSeconds: image.exposureSeconds })
    }

    if (line.k === 'msg' && line.dir === 'in' && line.blobs !== undefined) {
      const device = deviceOf(line.xml)

      if (device === undefined) throw new ArchiveError(`message ${line.n} on connection ${line.conn} carries images but names no device`)
      for (const path of line.blobs) deliveries.push({ path, device, at: line.at, ...(await headerOf(join(dir, path)).then(header => header, () => ({}))) })
    }
  }

  return { captures, deliveries, blobFiles: (await readdir(join(dir, blobsDirectory))).sort().map(name => `${blobsDirectory}/${name}`), window: { from: manifest.startedAt, to } }
}

const FrameRecord = Schema.Struct({
  rigId: Schema.String,
  exposureSeconds: Schema.Number,
  outcome: Schema.String,
  provenance: Schema.NullOr(Schema.Struct({ operationId: Schema.NullOr(Schema.String), imageId: Schema.NullOr(Schema.String) })),
  image: Schema.NullOr(Schema.Struct({ id: Schema.String, capturedAt: Schema.String })),
})

const AutofocusRecord = Schema.Struct({
  rigId: Schema.String,
  samples: Schema.Array(Schema.Struct({ capturedAt: Schema.String })),
})

/**
 * Every record in a JSON-lines file, decoded strictly. The last piece after the final newline is a torn tail
 * (the writer died mid-append) and is dropped, as the recording reader does; any other bad line is refused.
 */
async function records<S extends Schema.Decoder<unknown>>(path: string, schema: S): Promise<Array<S['Type']>> {
  const decode = Schema.decodeUnknownResult(Schema.fromJsonString(schema))
  const lines = (await readFile(path, 'utf8')).split('\n').slice(0, -1)

  return lines.flatMap((line, index) => {
    if (line === '') return []

    const decoded = decode(line)

    if (Result.isFailure(decoded)) throw new ArchiveError(`${path} line ${index + 1} does not decode: ${String(decoded.failure)}`)

    return [decoded.success]
  })
}

const epoch = (iso: string, where: string): number => {
  const ms = Date.parse(iso)

  if (!Number.isFinite(ms)) throw new ArchiveError(`${where}: ${iso} is not a time`)

  return ms
}

export interface VelaEvidence {
  readonly velaFrames: ReadonlyArray<VelaFrame>
  readonly samples: ReadonlyArray<AutofocusSample>
}

/** Vela's frame records and autofocus samples. A missing file is an error: archiving without Vela's side would prune everything. */
export async function readVelaEvidence(velaDir: string, rigId?: string): Promise<VelaEvidence> {
  const frames = join(velaDir, 'traces', 'frames.jsonl')
  const autofocus = join(velaDir, 'traces', 'autofocus.jsonl')
  const velaFrames: VelaFrame[] = []
  const samples: AutofocusSample[] = []

  for (const record of await records(frames, FrameRecord)) {
    if ((rigId !== undefined && record.rigId !== rigId) || record.image === null) continue
    velaFrames.push({
      velaImageId: record.image.id,
      outcome: record.outcome,
      imageId: record.provenance?.imageId ?? null,
      operationId: record.provenance?.operationId ?? null,
      capturedAt: epoch(record.image.capturedAt, `${frames} image ${record.image.id}`),
      exposureSeconds: record.exposureSeconds,
    })
  }

  for (const record of await records(autofocus, AutofocusRecord)) {
    if (rigId !== undefined && record.rigId !== rigId) continue
    for (const sample of record.samples) samples.push({ capturedAt: epoch(sample.capturedAt, `${autofocus} sample`) })
  }

  return { velaFrames, samples }
}
