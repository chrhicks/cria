import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { synthesizeTape } from '@cria/indi-replay'
import { readPrunedFrames, verifyRecording } from '@cria/recording'
import { archiveSession, type RunOptions } from './archive.js'
import { unpack } from './pack.js'
import { localSource, type Source } from './source.js'

const DAY = 24 * 60 * 60 * 1000
const older = '2026-03-01T04-00-00-11111111-1111-4111-8111-111111111111'
const newest = '2026-03-09T04-00-00-22222222-2222-4222-8222-222222222222'
const startAt = Date.UTC(2026, 2, 1, 4, 0, 0)
const exposure = 2
const frames = 6

let root: string
let errai: string
let archive: string
let vela: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cria-archive-'))
  errai = join(root, 'errai')
  archive = join(root, 'archive')
  vela = join(root, 'vela')
  await mkdir(errai)
  await mkdir(join(vela, 'traces'), { recursive: true })
})

afterEach(() => rm(root, { recursive: true, force: true }))

/** A session in errai's folder with `frames` images and, after each image, the `capture` op line Cria's ledger writes. */
async function session(name: string, over: { age?: number } = {}) {
  const folder = await synthesizeTape(
    { sensor: { width: 64, height: 48 }, exposureSeconds: exposure, stars: Array.from({ length: frames }, () => 0), site: { latitudeDegrees: 33.45, longitudeDegrees: -112.07 }, startAt, pointing: { raHours: 3, decDegrees: 30 } },
    join(errai, name),
  )
  const lines = (await readFile(join(folder, 'traffic.jsonl'), 'utf8')).split('\n').filter(line => line !== '')
  const out: string[] = []
  let k = 0

  for (const line of lines) {
    out.push(line)

    const parsed = JSON.parse(line) as { k: string; t: number; at: number; blobs?: string[] }

    if (parsed.k === 'msg' && parsed.blobs) {
      const startedAt = startAt + 1000 + k * (exposure * 1000 + 2000)

      out.push(
        JSON.stringify({
          k: 'op',
          t: parsed.t,
          at: parsed.at + 5,
          operation: {
            instanceId: 'synthetic',
            requestId: `req-${k}`,
            deviceId: 'primary',
            kind: 'capture',
            expectedName: 'Synthetic Camera',
            id: `op-${k}`,
            startedAt,
            settledAt: parsed.at + 5,
            state: 'settled',
            outcome: { kind: 'confirmed', value: { values: {}, image: { id: `img-${k}`, capturedAt: startedAt + 5, capturedAtSource: 'camera', exposureSeconds: exposure } } },
            recovery: null,
          },
        }),
      )
      k += 1
    }
  }
  await writeFile(join(folder, 'traffic.jsonl'), `${out.join('\n')}\n`)

  const modified = new Date(Date.now() - (over.age ?? 10 * DAY))

  await utimes(join(folder, 'traffic.jsonl'), modified, modified)

  return folder
}

const capturedAt = (k: number) => startAt + 1000 + k * (exposure * 1000 + 2000) + 5

const record = (k: number, outcome: string, provenance: boolean) => ({
  rigId: 'rig',
  exposureSeconds: exposure,
  outcome,
  provenance: provenance ? { requestId: `req-${k}`, operationId: `op-${k}`, imageId: `img-${k}` } : null,
  image: { id: `vela-${k}`, capturedAt: new Date(capturedAt(k)).toISOString() },
})

async function writeVela(records: unknown[], autofocus: ReadonlyArray<number>) {
  await writeFile(join(vela, 'traces', 'frames.jsonl'), records.map(entry => `${JSON.stringify(entry)}\n`).join(''))
  await writeFile(
    join(vela, 'traces', 'autofocus.jsonl'),
    autofocus.length === 0 ? '' : `${JSON.stringify({ rigId: 'rig', samples: autofocus.map(k => ({ capturedAt: new Date(capturedAt(k)).toISOString() })) })}\n`,
  )
}

/** Frames 0 and 1 saved, 2 unsaved, 3 an autofocus sample, 4 unknown to Vela, 5 saved with no image id. */
const usual = () => writeVela([record(0, 'saved', true), record(1, 'saved', true), record(2, 'unsaved', true), record(5, 'saved', false)], [3])

let logged: string[]
let source: Source

function options(over: Partial<RunOptions> = {}): RunOptions {
  return {
    source,
    stagingDir: join(archive, '.staging'),
    archiveDir: archive,
    velaDir: vela,
    apply: false,
    allowUnmatched: false,
    policy: { minAgeMs: 3 * DAY, liveWindowMs: 30 * 60 * 1000 },
    now: () => Date.now() + 1000,
    log: line => void logged.push(line),
    ...over,
  }
}

beforeEach(async () => {
  logged = []
  source = localSource(errai)
})

const names = (directory: string) => readdir(directory).then(list => list.sort())

describe('archiving a session', () => {
  it('keeps what Vela saved and the autofocus samples, packs them, proves the pack replays and leaves errai alone', async () => {
    await session(older)
    await session(newest)
    await usual()

    const status = await archiveSession(older, options())

    expect(status).toMatchObject({
      state: 'archived',
      ok: true,
      source: 'would-delete',
      frames: { kept: 4, pruned: 2, unmatched: 0, autofocusKept: 1, matchedByTime: 1, prunedByReason: { 'not saved by Vela': 1, 'no Vela record of this capture': 1 } },
    })
    expect(status.bytes!.archive).toBeGreaterThan(0)
    expect(await names(archive)).toEqual([`${older}.archive.json`, `${older}.tar.zst`, '.staging'].sort())
    expect(await names(join(archive, '.staging'))).toEqual([])
    expect(await names(errai)).toEqual([older, newest])
    expect((await verifyRecording(join(errai, older))).valid).toBe(true)

    const unpacked = join(root, 'unpacked')

    await mkdir(unpacked)
    await unpack(join(archive, `${older}.tar.zst`), unpacked)

    const folder = join(unpacked, older)
    const report = await verifyRecording(folder)
    const pruned = await readPrunedFrames(folder)

    expect(report.valid).toBe(true)
    expect(report.prunedImages.map(frame => frame.path)).toEqual(pruned.map(frame => frame.path))
    expect(pruned.map(frame => [frame.path, frame.reason])).toEqual([
      ['blobs/1-12-0.blob', 'not saved by Vela'],
      ['blobs/1-13-0.blob', 'no Vela record of this capture'],
    ].map(([path, reason]) => [expect.stringMatching(/^blobs\/\d+-\d+-0\.blob$/), reason]))
    expect((await names(join(folder, 'blobs'))).length).toBe(4)
    expect(logged.some(line => line.includes('would delete it on the source'))).toBe(true)
  })

  it('with --apply deletes the session on errai after the pack is in the archive, and a rerun has nothing left to do', async () => {
    await session(older)
    await session(newest)
    await usual()

    const status = await archiveSession(older, options({ apply: true }))

    expect(status).toMatchObject({ state: 'archived', ok: true, source: 'deleted' })
    expect(await names(errai)).toEqual([newest])
    expect(await archiveSession(older, options({ apply: true }))).toMatchObject({ state: 'already-archived', ok: true, source: 'deleted' })
  })

  it('finishes a delete that a dry run left undone, without copying again', async () => {
    await session(older)
    await session(newest)
    await usual()
    await archiveSession(older, options())

    let fetches = 0
    const counting: Source = { ...source, fetch: (name, into) => (fetches++, source.fetch(name, into)) }
    const status = await archiveSession(older, options({ apply: true, source: counting }))

    expect(status).toMatchObject({ state: 'already-archived', ok: true, source: 'deleted' })
    expect(fetches).toBe(0)
    expect(await names(errai)).toEqual([newest])
  })

  it('refuses to delete a session that changed on errai after it was archived', async () => {
    await session(older)
    await session(newest)
    await usual()
    await archiveSession(older, options())
    await appendFile(join(errai, older, 'traffic.jsonl'), '\n')
    await utimes(join(errai, older, 'traffic.jsonl'), new Date(Date.now() - 10 * DAY), new Date(Date.now() - 10 * DAY))

    const status = await archiveSession(older, options({ apply: true }))

    expect(status).toMatchObject({ state: 'failed', ok: false })
    expect(status.reason).toMatch(/not what was archived/)
    expect(await names(errai)).toEqual([older, newest])
  })

  it('does not touch the session Cria has open: newest by name, or written in the last 30 minutes', async () => {
    await session(older)
    await session(newest)
    await usual()

    expect(await archiveSession(newest, options({ apply: true }))).toMatchObject({ state: 'refused', ok: false, source: 'untouched' })
    await utimes(join(errai, older, 'traffic.jsonl'), new Date(), new Date())
    expect(await archiveSession(older, options({ apply: true }))).toMatchObject({ state: 'refused', source: 'untouched' })
    expect(await names(archive).catch(() => [])).toEqual([])
    expect(await names(errai)).toEqual([older, newest])
  })

  it('archives a young or pinned session but keeps it on errai even with --apply', async () => {
    await session(older, { age: DAY })
    await session(newest)
    await usual()

    expect(await archiveSession(older, options({ apply: true }))).toMatchObject({ state: 'archived', ok: true, source: 'kept', sourceReason: 'young' })
    await rm(join(archive, `${older}.archive.json`))
    await rm(join(archive, `${older}.tar.zst`))
    await utimes(join(errai, older, 'traffic.jsonl'), new Date(Date.now() - 10 * DAY), new Date(Date.now() - 10 * DAY))
    await writeFile(join(errai, older, 'keep'), 'needed for the paper')

    expect(await archiveSession(older, options({ apply: true }))).toMatchObject({ state: 'archived', source: 'kept', sourceReason: 'pinned' })
    expect(await names(errai)).toEqual([older, newest])
  })

  it('stops for review when a Vela record cannot be matched, and archives anyway only with --allow-unmatched', async () => {
    await session(older)
    await session(newest)
    await writeVela([record(0, 'saved', true), { ...record(1, 'saved', true), provenance: { requestId: 'r', operationId: 'op-1', imageId: 'img-not-here' } }], [])

    const blocked = await archiveSession(older, options({ apply: true }))

    expect(blocked).toMatchObject({ state: 'needs-review', ok: false, source: 'untouched', unmatched: [{ source: 'frame-record', id: 'vela-1', reason: 'image-not-in-recording' }] })
    expect(await names(archive)).toEqual(['.staging'])
    expect(await names(errai)).toEqual([older, newest])

    const allowed = await archiveSession(older, options({ apply: true, allowUnmatched: true }))

    expect(allowed).toMatchObject({ state: 'archived', ok: true, source: 'deleted', frames: { kept: 1, unmatched: 1 } })
  })

  it('stops for review when Vela has no records of the session at all', async () => {
    await session(older)
    await session(newest)
    await writeVela([], [])

    expect(await archiveSession(older, options())).toMatchObject({ state: 'needs-review', unmatched: [{ source: 'session', reason: 'no-vela-records' }] })
  })

  it('stops for review when the recording is damaged', async () => {
    await session(older)
    await session(newest)
    await usual()
    await rm(join(errai, older, 'blobs', (await readdir(join(errai, older, 'blobs')))[0]!))

    expect(await archiveSession(older, options({ apply: true }))).toMatchObject({ state: 'needs-review', ok: false, source: 'untouched' })
    expect(await names(errai)).toEqual([older, newest])
  })

  it('fails when Vela has no records file, rather than pruning every frame', async () => {
    await session(older)
    await session(newest)
    await rm(join(vela, 'traces'), { recursive: true })

    expect(await archiveSession(older, options({ apply: true }))).toMatchObject({ state: 'failed', ok: false, source: 'untouched' })
    expect(await names(errai)).toEqual([older, newest])
  })

  it('fails and archives nothing when the staged copy does not hash the same as errai', async () => {
    await session(older)
    await session(newest)
    await usual()

    const flaky: Source = {
      ...source,
      fetch: async (name, into) => {
        await source.fetch(name, into)
        await appendFile(join(into, name, 'blobs', (await readdir(join(into, name, 'blobs')))[3]!), 'x')
      },
    }
    const status = await archiveSession(older, options({ apply: true, source: flaky }))

    expect(status).toMatchObject({ state: 'failed', ok: false, source: 'untouched' })
    expect(status.reason).toMatch(/differs from the source|sha256 differs/)
    expect(await names(archive)).toEqual(['.staging'])
    expect(await names(errai)).toEqual([older, newest])
  })

  it('does not delete when the pack fails its check', async () => {
    await session(older)
    await session(newest)
    await usual()
    await writeFile(join(errai, older, 'pruned-frames.json'), '{}')

    const status = await archiveSession(older, options({ apply: true }))

    expect(status).toMatchObject({ state: 'failed', ok: false, source: 'untouched' })
    expect(await names(errai)).toEqual([older, newest])
  })

  it('refuses staging or archive folders that overlap the source, before it removes anything', async () => {
    await session(older)
    await session(newest)
    await usual()
    await writeFile(join(errai, older, 'keep'), 'pinned')
    await symlink(errai, join(root, 'errai-link'))

    for (const over of [
      { stagingDir: errai },
      { stagingDir: join(root, 'errai-link') },
      { stagingDir: join(errai, 'staging') },
      { archiveDir: join(errai, 'archive') },
      { stagingDir: root },
    ]) {
      expect(await archiveSession(older, options({ apply: true, ...over }))).toMatchObject({ state: 'refused', ok: false, source: 'untouched' })
      expect((await verifyRecording(join(errai, older))).valid).toBe(true)
      expect(await readFile(join(errai, older, 'keep'), 'utf8')).toBe('pinned')
    }
  })

  it('refuses an archive folder that is or sits inside staging, which cleanup would empty', async () => {
    await session(older)
    await session(newest)
    await usual()
    const staging = join(root, 'staging')

    for (const archiveDir of [staging, join(staging, older, 'archive'), join(staging, 'inner'), join(staging, '..inside')]) {
      expect(await archiveSession(older, options({ apply: true, stagingDir: staging, archiveDir }))).toMatchObject({ state: 'refused', ok: false, source: 'untouched' })
      expect(await names(errai)).toEqual([older, newest])
    }
  })

  it('refuses a second run on a session whose lock is held', async () => {
    await session(older)
    await session(newest)
    await usual()
    await mkdir(join(archive, '.staging'), { recursive: true })
    await writeFile(join(archive, '.staging', `${older}.lock`), '')

    expect(await archiveSession(older, options())).toMatchObject({ state: 'refused', ok: false })
    expect((await stat(join(archive, '.staging', `${older}.lock`))).isFile()).toBe(true)
  })
})
