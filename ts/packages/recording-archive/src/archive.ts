/**
 * One finished session, from errai to the archive on thuban:
 *
 *   1. copy it to staging and check every file's sha256 against the hash taken where the file lives;
 *   2. keep the frames Vela saved and the autofocus samples, list the rest in `pruned-frames.json`
 *      and remove those blobs from the staged copy (the source is never trimmed in place);
 *   3. pack the staged copy as tar + zstd;
 *   4. unpack the pack into a temp folder and run Cria's recording check and a short replay on it;
 *   5. move the pack into the archive, with a record of what the source held;
 *   6. only with `apply`, delete the session on the source, after the stage-1 guards and a check that the
 *      source still is what was archived.
 *
 * A session already in the archive skips steps 1 to 5, so a run that failed at the delete finishes it.
 */
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Result, Schema } from 'effect'
import { BlobPath, prunedFramesFile, verifyRecording } from '@cria/recording'
import { checkArchive } from './check.js'
import { readRecordingEvidence, readVelaEvidence } from './evidence.js'
import { ArchiveError, differences, differentHashes, hashFiles, ifMissing, listFiles, sha256File, type SourceFile } from './files.js'
import { moveFile, pack, unpack } from './pack.js'
import { planFrames, type Unmatched } from './plan.js'
import { protection, type Policy, type Source } from './source.js'

const ArchiveRecord = Schema.Struct({
  format: Schema.Literal(1),
  name: Schema.String,
  archivedAt: Schema.String,
  tarball: Schema.Struct({ file: Schema.String, bytes: Schema.Number, sha256: Schema.String }),
  /** What the source held when it was copied: enough to tell, before a delete, that it has not changed. */
  source: Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String, size: Schema.Number })), manifestSha256: Schema.String, trafficSha256: Schema.String }),
  frames: Schema.Struct({ kept: Schema.Number, pruned: Schema.Number, unmatched: Schema.Number }),
})

type ArchiveRecord = typeof ArchiveRecord.Type

export interface SessionStatus {
  name: string
  state: 'archived' | 'already-archived' | 'needs-review' | 'refused' | 'failed'
  ok: boolean
  reason?: string
  frames?: { kept: number; pruned: number; unmatched: number; autofocusKept: number; matchedByTime: number; prunedByReason: Record<string, number> }
  unmatched: ReadonlyArray<Unmatched>
  bytes?: { source: number; kept: number; pruned: number; archive: number }
  archive?: string
  /** What happened to the session on the source. `untouched`: nothing was archived. */
  source: 'deleted' | 'would-delete' | 'kept' | 'untouched'
  sourceReason?: string
}

export interface RunOptions {
  readonly source: Source
  readonly stagingDir: string
  readonly archiveDir: string
  readonly velaDir: string
  readonly rigId?: string
  readonly apply: boolean
  readonly allowUnmatched: boolean
  readonly policy: Policy
  readonly now: () => number
  readonly log: (line: string) => void
}

const tarballOf = (name: string) => `${name}.tar.zst`
const recordOf = (name: string) => `${name}.archive.json`

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

/** The record of an archived session, or undefined. A record that does not decode is refused, never read as absent. */
async function readRecord(archiveDir: string, name: string): Promise<ArchiveRecord | undefined> {
  const text = await readFile(join(archiveDir, recordOf(name)), 'utf8').then(content => content, ifMissing)

  if (text === undefined) return undefined

  const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(ArchiveRecord))(text)

  if (Result.isFailure(decoded)) throw new ArchiveError(`${recordOf(name)} does not decode: ${String(decoded.failure)}`)

  return decoded.success
}

const sum = (files: ReadonlyArray<SourceFile>) => files.reduce((total, file) => total + file.size, 0)

/** Steps 1 to 4, then 5. Returns the record, or undefined when the session needs review first (`status` says why). */
async function build(name: string, o: RunOptions, status: SessionStatus, log: (line: string) => void): Promise<ArchiveRecord | undefined> {
  const work = join(o.stagingDir, name)
  const verifyDir = join(o.stagingDir, `${name}.verify`)
  const tarball = join(o.stagingDir, tarballOf(name))

  for (const stale of [work, verifyDir, tarball]) await rm(stale, { recursive: true, force: true })

  const files = await o.source.inventory(name)
  const paths = files.map(file => file.path)

  if (paths.includes(prunedFramesFile)) throw new ArchiveError(`the source already holds ${prunedFramesFile}; a tool has pruned it before`)

  log(`1/6 hashing ${files.length} files (${Math.round(sum(files) / 1024 ** 2)} MiB) where they live`)
  const sourceHashes = await o.source.hashes(name, paths)

  log('1/6 copying to staging')
  await o.source.fetch(name, o.stagingDir)

  const copied = await listFiles(work)
  const missing = differences(files, copied)

  if (missing.length > 0) throw new ArchiveError(`the copy differs from the source: ${missing.slice(0, 3).join('; ')}`)

  const wrong = differentHashes(sourceHashes, await hashFiles(work, paths))

  if (wrong.length > 0) throw new ArchiveError(`sha256 differs after the copy: ${wrong.slice(0, 3).join(', ')}`)

  const moved = differences(files, await o.source.inventory(name))

  if (moved.length > 0) throw new ArchiveError(`the source changed while it was copied: ${moved.slice(0, 3).join('; ')}`)

  log('2/6 choosing the frames to keep')
  const report = await verifyRecording(work)

  if (!report.valid) {
    status.state = 'needs-review'
    status.reason = `the recording fails Cria's check: ${JSON.stringify(report.problems.slice(0, 3))}`

    return undefined
  }

  const plan = planFrames({ ...(await readRecordingEvidence(work)), ...(await readVelaEvidence(o.velaDir, o.rigId)) })
  const sizes = new Map(files.map(file => [file.path, file.size]))
  const bytesOf = (list: ReadonlyArray<{ path: string }>) => list.reduce((total, entry) => total + (sizes.get(entry.path) ?? 0), 0)
  const prunedByReason: Record<string, number> = {}

  for (const entry of plan.prune) prunedByReason[entry.reason] = (prunedByReason[entry.reason] ?? 0) + 1

  status.frames = {
    kept: plan.keep.length,
    pruned: plan.prune.length,
    unmatched: plan.unmatched.length,
    autofocusKept: plan.keep.filter(entry => entry.why.includes('autofocus sample')).length,
    matchedByTime: plan.matchedByTime,
    prunedByReason,
  }
  status.unmatched = plan.unmatched
  status.bytes = { source: sum(files), kept: bytesOf(plan.keep), pruned: bytesOf(plan.prune), archive: 0 }

  if (plan.unmatched.length > 0 && !o.allowUnmatched) {
    status.state = 'needs-review'
    status.reason = `${plan.unmatched.length} frames Vela records could not be matched to a recorded image; nothing was archived or deleted (--allow-unmatched archives anyway)`

    return undefined
  }

  const listed = plan.prune.filter(entry => Schema.is(BlobPath)(entry.path))

  if (listed.length > 0) {
    const at = o.now()

    await writeJson(join(work, prunedFramesFile), { format: 1, frames: listed.map(entry => ({ path: entry.path, reason: entry.reason, prunedAt: at })) })
  }
  for (const entry of plan.prune) await rm(join(work, entry.path), { force: true })

  log(`3/6 packing ${plan.keep.length} kept and ${plan.prune.length} pruned frames`)
  await pack(o.stagingDir, name, tarball)
  const tarballSha = await sha256File(tarball)
  const tarballBytes = (await stat(tarball)).size

  log('4/6 unpacking the pack: recording check and short replay')
  await mkdir(verifyDir, { recursive: true })
  await unpack(tarball, verifyDir)
  const checked = await checkArchive(join(verifyDir, name))

  log(`4/6 check passed: ${checked.images} images, ${checked.prunedImages} pruned${checked.replayed ? `, replayed frame ${checked.replayed.index}${checked.replayed.pruned ? ' (pruned: Alert)' : ''}` : ''}`)
  await rm(verifyDir, { recursive: true, force: true })

  log(`5/6 moving the pack to ${o.archiveDir}`)
  await moveFile(tarball, join(o.archiveDir, tarballOf(name)))

  const record: ArchiveRecord = {
    format: 1,
    name,
    archivedAt: new Date(o.now()).toISOString(),
    tarball: { file: tarballOf(name), bytes: tarballBytes, sha256: tarballSha },
    source: { files, manifestSha256: sourceHashes.get('manifest.json') ?? '', trafficSha256: sourceHashes.get('traffic.jsonl') ?? '' },
    frames: { kept: plan.keep.length, pruned: plan.prune.length, unmatched: plan.unmatched.length },
  }

  await writeJson(join(o.archiveDir, recordOf(name)), record)
  await rm(work, { recursive: true, force: true })
  status.bytes.archive = tarballBytes

  return record
}

/** Step 6. The guards run again here: the session may have been pinned or Cria may have moved on since the run began. */
async function release(name: string, record: ArchiveRecord, o: RunOptions, status: SessionStatus, log: (line: string) => void): Promise<void> {
  const guard = protection(await o.source.list(), name, o.now(), o.policy)

  if (guard !== undefined) {
    status.source = 'kept'
    status.sourceReason = guard
    log(`6/6 keeping it on the source: ${guard}`)

    return
  }

  const files = await o.source.inventory(name)
  const changed = differences(record.source.files, files)
  const small = await o.source.hashes(name, ['manifest.json', 'traffic.jsonl'])

  if (changed.length > 0 || small.get('manifest.json') !== record.source.manifestSha256 || small.get('traffic.jsonl') !== record.source.trafficSha256) {
    throw new ArchiveError(`the source is not what was archived any more${changed.length > 0 ? `: ${changed.slice(0, 3).join('; ')}` : ''}; not deleting`)
  }

  if (!o.apply) {
    status.source = 'would-delete'
    log(`6/6 would delete it on the source (${Math.round(sum(files) / 1024 ** 2)} MiB); run with --apply to do it`)

    return
  }

  await o.source.remove(name)
  if ((await o.source.list()).some(entry => entry.name === name)) throw new ArchiveError('the source still lists the session after the delete')

  status.source = 'deleted'
  log('6/6 deleted on the source')
}

export async function archiveSession(name: string, o: RunOptions): Promise<SessionStatus> {
  const log = (line: string) => o.log(`${name}: ${line}`)
  const status: SessionStatus = { name, state: 'failed', ok: false, unmatched: [], source: 'untouched' }
  const refusal = protection(await o.source.list(), name, o.now(), o.policy)

  if (refusal === 'missing' && (await readRecord(o.archiveDir, name)) !== undefined) {
    status.state = 'already-archived'
    status.ok = true
    status.source = 'deleted'
    status.sourceReason = 'already gone from the source'
    log('already archived, and gone from the source')

    return status
  }

  if (refusal === 'missing' || refusal === 'not-a-session' || refusal === 'open') {
    status.state = 'refused'
    status.reason = refusal === 'open' ? 'Cria has this session open (newest, or written in the last 30 minutes)' : refusal === 'missing' ? 'no such session on the source' : 'not a session folder'
    log(`refused: ${status.reason}`)

    return status
  }

  await mkdir(o.stagingDir, { recursive: true })
  await mkdir(o.archiveDir, { recursive: true })

  const lockPath = join(o.stagingDir, `${name}.lock`)
  const lock = await open(lockPath, 'wx').then(
    handle => handle,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') return undefined

      throw error
    },
  )

  if (lock === undefined) {
    status.state = 'refused'
    status.reason = `${lockPath} exists: another run holds this session. Remove it if no run is active`

    return status
  }

  try {
    await lock.close()
    const existing = await readRecord(o.archiveDir, name)
    let record = existing

    if (existing) {
      const file = join(o.archiveDir, existing.tarball.file)

      if ((await sha256File(file)) !== existing.tarball.sha256) throw new ArchiveError(`${file} does not match its record; not touching it`)
      log('already in the archive; going to step 6')
      status.archive = file
      status.frames = { ...existing.frames, autofocusKept: 0, matchedByTime: 0, prunedByReason: {} }
      status.bytes = { source: sum(existing.source.files), kept: 0, pruned: 0, archive: existing.tarball.bytes }
    } else {
      record = await build(name, o, status, log)
    }

    if (record === undefined) return status

    status.archive = join(o.archiveDir, record.tarball.file)
    status.state = existing ? 'already-archived' : 'archived'
    await release(name, record, o, status, log)
    status.ok = true
  } catch (error) {
    status.state = 'failed'
    status.reason = error instanceof Error ? error.message : String(error)
    log(`failed: ${status.reason}`)
  } finally {
    await rm(lockPath, { force: true })
  }

  return status
}

export interface RunStatus {
  at: string
  mode: 'apply' | 'dry-run'
  ok: boolean
  archiveDir: string
  sessions: SessionStatus[]
}

export async function archiveSessions(names: ReadonlyArray<string>, o: RunOptions): Promise<RunStatus> {
  const sessions: SessionStatus[] = []

  for (const name of names) sessions.push(await archiveSession(name, o))

  return { at: new Date(o.now()).toISOString(), mode: o.apply ? 'apply' : 'dry-run', ok: sessions.every(session => session.ok), archiveDir: o.archiveDir, sessions }
}
