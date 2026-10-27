/**
 * Reading a recording, on thuban: replay, the packager and `verifyRecording`.
 * A final line with no newline is a torn tail (Cria died mid-append) and is
 * dropped. A terminated line that does not decode is damage in the middle,
 * which no reader may skip.
 */
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Result, Schema } from 'effect'
import { Manifest, PrunedFrames, RecordingLine, blobsDirectory, manifestFile, prunedFramesFile, trafficFile, type GapLine, type MessageLine, type PrunedFrame } from './format.js'

type Item =
  | { readonly kind: 'line'; readonly number: number; readonly line: RecordingLine }
  | { readonly kind: 'damaged'; readonly number: number; readonly message: string }
  | { readonly kind: 'torn'; readonly number: number }

export class DamagedRecordingError extends Error {
  override readonly name = 'DamagedRecordingError'
}

const decodeLine = Schema.decodeUnknownResult(RecordingLine)
const decodeManifest = Schema.decodeUnknownResult(Manifest)
const decodePrunedFrames = Schema.decodeUnknownResult(PrunedFrames)

function decode(text: string, number: number): Item {
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    return { kind: 'damaged', number, message: `not JSON: ${(error as Error).message}` }
  }

  const decoded = decodeLine(json)

  return Result.isSuccess(decoded) ? { kind: 'line', number, line: decoded.success } : { kind: 'damaged', number, message: String(decoded.failure) }
}

async function* items(dir: string): AsyncGenerator<Item> {
  let pending = ''
  let number = 0

  for await (const chunk of createReadStream(join(dir, trafficFile), { encoding: 'utf8' })) {
    pending += chunk
    let end = pending.indexOf('\n')

    while (end >= 0) {
      number += 1
      yield decode(pending.slice(0, end), number)
      pending = pending.slice(end + 1)
      end = pending.indexOf('\n')
    }
  }

  if (pending.length > 0) yield { kind: 'torn', number: number + 1 }
}

export async function readManifest(dir: string): Promise<Manifest> {
  const decoded = decodeManifest(JSON.parse(await readFile(join(dir, manifestFile), 'utf8')))

  if (Result.isFailure(decoded)) throw new DamagedRecordingError(`${manifestFile}: ${String(decoded.failure)}`)

  return decoded.success
}

/**
 * The blobs removed on purpose, from `pruned-frames.json`. No file is an empty list. A file that is not JSON,
 * does not match the shape or lists a path twice throws `DamagedRecordingError`, never an empty list.
 */
export async function readPrunedFrames(dir: string): Promise<ReadonlyArray<PrunedFrame>> {
  let text: string

  try {
    text = await readFile(join(dir, prunedFramesFile), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DamagedRecordingError(`${prunedFramesFile}: not JSON: ${(error as Error).message}`)
  }

  const decoded = decodePrunedFrames(json)

  if (Result.isFailure(decoded)) throw new DamagedRecordingError(`${prunedFramesFile}: ${String(decoded.failure)}`)

  const paths = new Set<string>()

  for (const { path } of decoded.success.frames) {
    if (paths.has(path)) throw new DamagedRecordingError(`${prunedFramesFile}: ${path} is listed twice`)
    paths.add(path)
  }

  return decoded.success.frames
}

/** Every line in file order. Drops a torn tail. Throws `DamagedRecordingError` at a damaged line. */
export async function* readRecording(dir: string): AsyncGenerator<RecordingLine> {
  for await (const item of items(dir)) {
    if (item.kind === 'damaged') throw new DamagedRecordingError(`${trafficFile} line ${item.number}: ${item.message}`)
    if (item.kind === 'line') yield item.line
  }
}

export type Problem =
  | { readonly kind: 'bad-manifest'; readonly message: string }
  | { readonly kind: 'bad-pruned-frames'; readonly message: string }
  | { readonly kind: 'damaged-line'; readonly line: number; readonly message: string }
  | { readonly kind: 'missing-image'; readonly line: number; readonly path: string }
  | { readonly kind: 'image-size'; readonly line: number; readonly path: string; readonly expected: number; readonly found: number }
  | { readonly kind: 'message-skipped'; readonly line: number; readonly conn: number; readonly dir: 'in' | 'out'; readonly expected: number; readonly found: number }
  | { readonly kind: 'time-went-back'; readonly line: number }
  | { readonly kind: 'line-after-gap'; readonly line: number }
  | { readonly kind: 'line-after-end'; readonly line: number }

export interface RecordingReport {
  /** No problems. A torn tail, a gap, a missing `end`, unreferenced files and pruned frames are not problems. */
  readonly valid: boolean
  /** Cria shut down cleanly: the last line is `end`. */
  readonly ended: boolean
  readonly tornTail: boolean
  readonly lines: number
  readonly messages: number
  readonly operations: number
  readonly images: number
  readonly gaps: ReadonlyArray<GapLine>
  /** Images a line names, that are missing and that `pruned-frames.json` lists: intentional gaps. */
  readonly prunedImages: ReadonlyArray<PrunedFrame>
  /** Paths `pruned-frames.json` lists whose file still exists. Harmless: the file is used. */
  readonly prunedStillPresent: ReadonlyArray<string>
  readonly problems: ReadonlyArray<Problem>
  /** Files in `blobs/` that no line names: a crash between an image and its line. Harmless. */
  readonly orphans: ReadonlyArray<string>
}

async function imageFiles(dir: string): Promise<ReadonlySet<string>> {
  const names = await readdir(join(dir, blobsDirectory))

  return new Set(names.map(name => `${blobsDirectory}/${name}`))
}

/**
 * The size each `oneBLOB` states for its file: INDI's `size` is the decoded
 * byte count. A compressed payload (`format` ending `.z`) states its size
 * after inflating, which the file does not hold, so it has no size to check.
 */
function statedSizes(xml: string): ReadonlyMap<string, number> {
  const sizes = new Map<string, number>()

  for (const [element] of xml.matchAll(/<oneBLOB\b[^>]*?\/>/g)) {
    const attribute = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1]
    const ref = attribute('ref')
    const size = attribute('size')

    if (ref !== undefined && size !== undefined && /^[0-9]+$/.test(size) && !(attribute('format') ?? '').endsWith('.z')) sizes.set(ref, Number(size))
  }

  return sizes
}

export async function verifyRecording(dir: string): Promise<RecordingReport> {
  const problems: Problem[] = []
  const gaps: GapLine[] = []
  const named = new Set<string>()
  const expected = new Map<string, number>()
  const pruned = new Map<string, PrunedFrame>()
  const prunedImages = new Map<string, PrunedFrame>()
  const onDisk = await imageFiles(dir)
  let lines = 0
  let messages = 0
  let operations = 0
  let tornTail = false
  let ended = false
  let gapped = false
  let lastTime = 0

  try {
    await readManifest(dir)
  } catch (error) {
    problems.push({ kind: 'bad-manifest', message: (error as Error).message })
  }

  try {
    for (const frame of await readPrunedFrames(dir)) pruned.set(frame.path, frame)
  } catch (error) {
    if (!(error instanceof DamagedRecordingError)) throw error
    problems.push({ kind: 'bad-pruned-frames', message: error.message })
  }

  const check = (number: number, line: RecordingLine) => {
    if (ended) problems.push({ kind: 'line-after-end', line: number })
    else if (gapped && line.k !== 'end') problems.push({ kind: 'line-after-gap', line: number })
    if (line.t < lastTime) problems.push({ kind: 'time-went-back', line: number })
    lastTime = Math.max(lastTime, line.t)
  }

  const checkMessage = async (number: number, line: MessageLine) => {
    const key = `${line.conn}:${line.dir}`
    const next = expected.get(key) ?? 0

    if (line.n !== next) problems.push({ kind: 'message-skipped', line: number, conn: line.conn, dir: line.dir, expected: next, found: line.n })
    expected.set(key, line.n + 1)
    const stated = statedSizes(line.xml)

    for (const path of line.blobs ?? []) {
      named.add(path)
      if (!onDisk.has(path)) {
        const listed = pruned.get(path)

        if (listed) prunedImages.set(path, listed)
        else problems.push({ kind: 'missing-image', line: number, path })
        continue
      }

      const expected = stated.get(path)

      if (expected === undefined) continue

      const found = (await stat(join(dir, path))).size

      if (found !== expected) problems.push({ kind: 'image-size', line: number, path, expected, found })
    }
  }

  for await (const item of items(dir)) {
    if (item.kind === 'torn') {
      tornTail = true
      continue
    }

    if (item.kind === 'damaged') {
      problems.push({ kind: 'damaged-line', line: item.number, message: item.message })
      continue
    }

    lines += 1
    check(item.number, item.line)
    if (item.line.k === 'msg') {
      messages += 1
      await checkMessage(item.number, item.line)
    }

    if (item.line.k === 'op') operations += 1

    if (item.line.k === 'gap') {
      gapped = true
      gaps.push(item.line)
    }

    if (item.line.k === 'end') ended = true
  }

  return {
    valid: problems.length === 0,
    ended,
    tornTail,
    lines,
    messages,
    operations,
    images: named.size,
    gaps,
    prunedImages: [...prunedImages.values()],
    prunedStillPresent: [...pruned.keys()].filter(path => onDisk.has(path)).sort(),
    problems,
    orphans: [...onDisk].filter(path => !named.has(path)).sort(),
  }
}
