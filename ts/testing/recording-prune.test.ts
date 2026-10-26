import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadTape, synthesizeTape } from '../packages/indi-replay/src/index.js'
import { verifyRecording } from '../packages/recording/src/index.js'
// @ts-expect-error plain ESM script with JSDoc types, not part of a TypeScript project
import { defaults, planPrune, prune, readRecordConfig, writeStatus } from '../deploy/recording-prune.mjs'

const GiB = 1024 ** 3
const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 25, 16, 0, 0)
const policy = { headroomBytes: 60 * GiB, minAgeMs: 3 * DAY, liveWindowMs: defaults.liveWindowMs }
const reserveBytes = 60 * GiB

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const named = (day: number, n = day) => `2026-10-${String(day).padStart(2, '0')}T12-00-00-000Z-${id(n)}`

interface Entry {
  name: string
  isDirectory: boolean
  isSymlink: boolean
  manifestOk: boolean
  bytes: number
  lastWriteMs: number
  pinned: boolean
}

/** A session that stopped writing `daysAgo` days before `now`. */
const session = (day: number, daysAgo: number, gb: number, extra: Partial<Entry> = {}): Entry => ({
  name: named(day),
  isDirectory: true,
  isSymlink: false,
  manifestOk: true,
  bytes: gb * GiB,
  lastWriteMs: now - daysAgo * DAY,
  pinned: false,
  ...extra,
})

const plan = (entries: Entry[], freeGb: number) => planPrune({ entries, freeBytes: freeGb * GiB, reserveBytes, now, policy })
const names = (picks: Array<{ name: string }>) => picks.map(pick => pick.name)

describe('planPrune', () => {
  it('deletes nothing when free space already meets the target', () => {
    const result = plan([session(10, 10, 20), session(11, 9, 20), session(24, 0.01, 4)], 120)

    expect(result.remove).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.targetBytes).toBe(120 * GiB)
  })

  it('deletes the oldest session first, ordered by last write and not by name', () => {
    const early = session(10, 3.5, 20)
    const late = session(11, 9, 20)
    const open = session(24, 0.01, 4)

    expect(names(plan([early, late, open], 100).remove)).toEqual([late.name])
    expect(names(plan([early, late, open], 70).remove)).toEqual([late.name, early.name])
  })

  it('stops exactly at the target', () => {
    const entries = [session(10, 9, 10), session(11, 8, 10), session(12, 7, 10), session(24, 0.01, 4)]

    expect(names(plan(entries, 100).remove)).toEqual([entries[0]!.name, entries[1]!.name])
    expect(plan(entries, 100).freeAfterBytes).toBe(120 * GiB)
    expect(plan(entries, 100).ok).toBe(true)
    expect(names(plan(entries, 109.9).remove)).toEqual([entries[0]!.name, entries[1]!.name])
    expect(names(plan(entries, 110).remove)).toEqual([entries[0]!.name])
  })

  it('never picks the newest session, even when it is old and the only one over the line', () => {
    const only = session(10, 20, 80)
    const result = plan([only], 50)

    expect(result.remove).toEqual([])
    expect(result.skipped).toEqual([{ name: only.name, bytes: only.bytes, reason: 'open' }])
    expect(result.ok).toBe(false)
  })

  it('never picks a session written in the last 30 minutes, even with a zero age floor', () => {
    const live = session(10, 0.01, 20)
    const newest = session(24, 0.0001, 1)
    const result = planPrune({ entries: [live, newest], freeBytes: 0, reserveBytes, now, policy: { ...policy, minAgeMs: 0 } })

    expect(result.remove).toEqual([])
    expect(result.skipped.map(entry => entry.reason)).toEqual(['open', 'open'])
  })

  it('skips young and pinned sessions and takes the next oldest', () => {
    const pinned = session(10, 20, 30, { pinned: true })
    const young = session(11, 2, 30)
    const old = session(12, 9, 30)
    const open = session(24, 0.01, 4)
    const result = plan([pinned, young, old, open], 90)

    expect(names(result.remove)).toEqual([old.name])
    expect(result.skipped.map(entry => [entry.name, entry.reason])).toEqual([
      [pinned.name, 'pinned'],
      [young.name, 'young'],
      [open.name, 'open'],
    ])
    expect(result.ok).toBe(true)
  })

  it('reports ok: false with a reason when everything left is pinned, young or open', () => {
    const result = plan([session(10, 20, 30, { pinned: true }), session(11, 2, 30), session(12, 9, 10), session(24, 0.01, 4)], 60)

    expect(names(result.remove)).toEqual([named(12)])
    expect(result.ok).toBe(false)
    expect(result.freeAfterBytes).toBe(70 * GiB)
    expect(result.reason).toBe('short of the target by 50 GB with 1 sessions selected; kept: 1 open, 1 pinned, 1 young')
  })

  it('ignores names that are not sessions, symlinks, plain files and folders with a bad manifest', () => {
    const real = session(10, 9, 30)
    const entries = [
      session(1, 30, 30, { name: 'notes' }),
      session(2, 30, 30, { name: `${named(2)}.pruning` }),
      session(3, 30, 30, { isSymlink: true, isDirectory: false }),
      session(4, 30, 30, { isDirectory: false }),
      session(5, 30, 30, { manifestOk: false }),
      real,
      session(24, 0.01, 4),
    ]
    const result = plan(entries, 50)

    expect(names(result.remove)).toEqual([real.name])
    expect(result.ignored.sort()).toEqual([entries[0]!.name, entries[1]!.name, entries[2]!.name, entries[3]!.name, entries[4]!.name].sort())
  })

  it('counts tiny boot-noise sessions by their bytes, not as sessions', () => {
    const noise = [session(10, 9, 0.00002), session(11, 8.9, 0.00002)]
    const big = session(12, 8, 28)
    const result = plan([...noise, big, session(24, 0.01, 4)], 100)

    expect(names(result.remove)).toEqual([noise[0]!.name, noise[1]!.name, big.name])
  })

  it('is satisfied by free space equal to the target with no sessions at all', () => {
    expect(plan([], 120).ok).toBe(true)
    expect(plan([], 119).ok).toBe(false)
  })
})

describe('readRecordConfig', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recording-prune-config-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reads dir and reserveGb from the rig config', async () => {
    const path = join(directory, 'rig.json')

    await writeFile(path, JSON.stringify({ record: { dir: '/x', reserveGb: 60, queueMb: 256 }, devices: [] }))
    expect(readRecordConfig(path)).toEqual({ dir: '/x', reserveBytes: 60 * GiB })
    await writeFile(path, JSON.stringify({ devices: [] }))
    expect(readRecordConfig(path)).toBeUndefined()
    await writeFile(path, JSON.stringify({ record: { dir: '/x' } }))
    expect(() => readRecordConfig(path)).toThrow('record needs dir and reserveGb')
  })
})

describe('prune on a real folder', () => {
  const mb = 1024 * 1024
  let directory: string
  let lines: string[]

  /** A session with a manifest, a traffic file last written `daysAgo` days ago, and one real (non-sparse) blob. */
  async function makeSession(day: number, daysAgo: number, blobMb: number, options: { keep?: boolean } = {}) {
    const name = named(day)
    const folder = join(directory, name)

    await mkdir(join(folder, 'blobs'), { recursive: true })
    await writeFile(join(folder, 'manifest.json'), JSON.stringify({ format: 1, recording: name }))
    await writeFile(join(folder, 'traffic.jsonl'), '')
    await writeFile(join(folder, 'blobs/1-0-0.blob'), Buffer.alloc(blobMb * mb, 1))
    if (options.keep) await writeFile(join(folder, 'keep'), 'the 2026-10-24 night\n')

    const at = new Date(now - daysAgo * DAY)

    await utimes(join(folder, 'traffic.jsonl'), at, at)

    return name
  }

  const run = (options: { apply: boolean; freeMb: number; targetMb: number; afterScan?: () => Promise<void> }) =>
    prune({
      dir: directory,
      reserveBytes: 0,
      apply: options.apply,
      policy: { headroomBytes: options.targetMb * mb, minAgeMs: 3 * DAY, liveWindowMs: defaults.liveWindowMs },
      now: () => now,
      freeBytes: async () => {
        await options.afterScan?.()

        return options.freeMb * mb
      },
      log: line => lines.push(line),
    })

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recording-prune-'))
    lines = []
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('in dry-run reports the plan and removes nothing', async () => {
    const oldest = await makeSession(10, 9, 2)

    await makeSession(24, 0.01, 1)

    const status = await run({ apply: false, freeMb: 1, targetMb: 3 })

    expect(status.mode).toBe('dry-run')
    expect(status.wouldDelete.map((row: { name: string }) => row.name)).toEqual([oldest])
    expect(status.deleted).toEqual([])
    expect(status.ok).toBe(false)
    expect(status.reason).toContain('dry run, so nothing was deleted (it would delete 1)')
    expect(existsSync(join(directory, oldest))).toBe(true)
    expect(lines.some(line => line.startsWith('would delete ' + oldest))).toBe(true)
  })

  it('with apply removes exactly the planned folders, keeps a pinned one, and changes nothing on the second run', async () => {
    const first = await makeSession(10, 9, 2)
    const pinned = await makeSession(11, 8, 2, { keep: true })
    const second = await makeSession(12, 7, 2)
    const young = await makeSession(13, 1, 2)
    const open = await makeSession(24, 0.01, 1)

    await mkdir(join(directory, 'other-stuff'))
    await writeFile(join(directory, 'other-stuff/readme.txt'), 'not ours')

    const status = await run({ apply: true, freeMb: 0, targetMb: 3 })

    expect(status.deleted.map((row: { name: string }) => row.name)).toEqual([first, second])
    expect((await readdir(directory)).sort()).toEqual([pinned, young, open, 'other-stuff'].sort())
    expect(await readFile(join(directory, pinned, 'keep'), 'utf8')).toBe('the 2026-10-24 night\n')
    expect(await readFile(join(directory, 'other-stuff/readme.txt'), 'utf8')).toBe('not ours')

    const again = await run({ apply: true, freeMb: 4, targetMb: 3 })

    expect(again.deleted).toEqual([])
    expect(again.ok).toBe(true)
    expect((await readdir(directory)).sort()).toEqual([pinned, young, open, 'other-stuff'].sort())
  })

  it('finishes a leftover .pruning folder from a crashed run', async () => {
    const stuck = await makeSession(10, 9, 1)
    await rename(join(directory, stuck), join(directory, `${stuck}.pruning`))
    await makeSession(24, 0.01, 1)

    const dry = await run({ apply: false, freeMb: 10, targetMb: 3 })

    expect(dry.finishedLeftovers).toEqual([])
    expect(existsSync(join(directory, `${stuck}.pruning`))).toBe(true)

    const status = await run({ apply: true, freeMb: 10, targetMb: 3 })

    expect(status.finishedLeftovers).toEqual([`${stuck}.pruning`])
    expect(existsSync(join(directory, `${stuck}.pruning`))).toBe(false)
  })

  it('leaves a pinned .pruning leftover alone and reports it', async () => {
    const stuck = await makeSession(10, 9, 1, { keep: true })

    await rename(join(directory, stuck), join(directory, `${stuck}.pruning`))
    await makeSession(24, 0.01, 1)

    const status = await run({ apply: true, freeMb: 10, targetMb: 3 })

    expect(status.finishedLeftovers).toEqual([])
    expect(status.kept).toContainEqual(expect.objectContaining({ name: `${stuck}.pruning`, reason: 'pinned' }))
    expect(await readFile(join(directory, `${stuck}.pruning`, 'keep'), 'utf8')).toBe('the 2026-10-24 night\n')
    expect(existsSync(join(directory, `${stuck}.pruning`, 'blobs/1-0-0.blob'))).toBe(true)
  })

  it('does not follow a symlink named like a session', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'recording-prune-outside-'))

    try {
      await writeFile(join(outside, 'precious'), 'x')
      await symlink(outside, join(directory, named(10)))
      await makeSession(24, 0.01, 1)

      const status = await run({ apply: true, freeMb: 0, targetMb: 3 })

      expect(status.deleted).toEqual([])
      expect(status.ok).toBe(false)
      expect(await readFile(join(outside, 'precious'), 'utf8')).toBe('x')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('does not delete a session that was pinned after the scan', async () => {
    const old = await makeSession(10, 9, 2)

    await makeSession(24, 0.01, 1)

    let calls = 0
    const status = await run({
      apply: true,
      freeMb: 0,
      targetMb: 1,
      afterScan: async () => {
        if (calls++ === 0) await writeFile(join(directory, old, 'keep'), 'pinned while running\n')
      },
    })

    expect(status.deleted).toEqual([])
    expect(status.ok).toBe(false)
    expect(status.reason).toContain('pinned since the scan')
    expect(existsSync(join(directory, old, 'blobs/1-0-0.blob'))).toBe(true)
  })

  it('does not delete through a root that was swapped for a symlink after the scan', async () => {
    const old = await makeSession(10, 9, 2)
    const elsewhere = await mkdtemp(join(tmpdir(), 'recording-prune-elsewhere-'))

    try {
      await makeSession(24, 0.01, 1)
      await mkdir(join(elsewhere, old))
      await writeFile(join(elsewhere, old, 'precious'), 'x')

      let calls = 0
      const status = await run({
        apply: true,
        freeMb: 0,
        targetMb: 1,
        afterScan: async () => {
          if (calls++ > 0) return
          await rename(directory, `${directory}-moved`)
          await symlink(elsewhere, directory)
        },
      })

      expect(status.deleted).toEqual([])
      expect(status.ok).toBe(false)
      expect(await readFile(join(elsewhere, old, 'precious'), 'utf8')).toBe('x')
      expect(existsSync(join(`${directory}-moved`, old, 'blobs/1-0-0.blob'))).toBe(true)
    } finally {
      await rm(directory, { force: true })
      await rename(`${directory}-moved`, directory).catch(() => undefined)
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('reports ok: false and a reason when pins and the age floor leave it short, and writes the status file', async () => {
    await makeSession(10, 20, 2, { keep: true })
    await makeSession(11, 1, 2)
    await makeSession(24, 0.01, 1)

    const status = await run({ apply: true, freeMb: 1, targetMb: 100 })
    const statusFile = join(directory, 'state/cria/recording-prune.json')

    await writeStatus(statusFile, status)

    const written = JSON.parse(await readFile(statusFile, 'utf8'))

    expect(written.ok).toBe(false)
    expect(written.reason).toContain('kept: 1 open, 1 pinned, 1 young')
    expect(written.deleted).toEqual([])
    expect(written.mode).toBe('apply')
    expect(written.at).toBe(new Date(now).toISOString())
    expect(Object.keys(written)).toEqual(expect.arrayContaining(['freeGb', 'targetGb', 'freeAfterGb', 'wouldDelete', 'kept']))
    expect(existsSync(`${statusFile}.tmp`)).toBe(false)
  })
})

describe('the keep marker', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recording-prune-keep-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('does not break verifyRecording or loadTape', async () => {
    const folder = await synthesizeTape(
      {
        sensor: { width: 160, height: 128 },
        exposureSeconds: 2,
        stars: [6, 6, 0],
        site: { latitudeDegrees: 40, longitudeDegrees: -75 },
        startAt: Date.UTC(2026, 2, 1, 4, 0, 0),
        pointing: { raHours: 3, decDegrees: 30 },
      },
      join(directory, 'tape'),
    )
    const before = await verifyRecording(folder)

    await writeFile(join(folder, 'keep'), 'a night worth keeping\n')

    expect(before.valid).toBe(true)
    expect(await verifyRecording(folder)).toEqual(before)
    expect((await loadTape(folder)).events.length).toBeGreaterThan(0)
  })

  it('leaves the script runnable from the command line in dry-run', async () => {
    const config = join(directory, 'rig.json')
    const recordings = join(directory, 'recordings')
    const state = join(directory, 'state.json')

    await mkdir(recordings)
    await writeFile(config, JSON.stringify({ record: { dir: recordings, reserveGb: 0, queueMb: 1 } }))

    const output = execFileSync(process.execPath, [join(import.meta.dirname, '../deploy/recording-prune.mjs'), '--config', config, '--state', state, '--headroom-gb', '0'], { encoding: 'utf8' })
    const status = JSON.parse(await readFile(state, 'utf8'))

    expect(output).toContain('recording-prune: dry-run:')
    expect(status).toMatchObject({ mode: 'dry-run', ok: true, deleted: [], wouldDelete: [] })
  })

  it('records a failed run in the status file instead of leaving the last good one', async () => {
    const state = join(directory, 'state.json')
    const script = join(import.meta.dirname, '../deploy/recording-prune.mjs')

    await writeStatus(state, { ok: true, at: 'yesterday' })
    await writeFile(join(directory, 'rig.json'), JSON.stringify({ record: { dir: join(directory, 'missing'), reserveGb: 0, queueMb: 1 } }))

    const missing = spawnSync(process.execPath, [script, '--config', join(directory, 'rig.json'), '--state', state], { encoding: 'utf8' })

    expect(missing.status).toBe(1)
    expect(JSON.parse(await readFile(state, 'utf8'))).toMatchObject({ ok: false, mode: 'dry-run' })

    await writeFile(state, JSON.stringify({ ok: true, at: 'yesterday' }))

    const badConfig = spawnSync(process.execPath, [script, '--config', join(directory, 'nope.json'), '--state', state], { encoding: 'utf8' })

    expect(badConfig.status).toBe(2)
    expect(JSON.parse(await readFile(state, 'utf8')).ok).toBe(false)

    await writeFile(state, JSON.stringify({ ok: true, at: 'yesterday' }))

    const badNumber = spawnSync(process.execPath, [script, '--config', join(directory, 'rig.json'), '--state', state, '--headroom-gb', 'bad'], { encoding: 'utf8' })

    expect(badNumber.status).toBe(2)
    expect(JSON.parse(await readFile(state, 'utf8'))).toMatchObject({ ok: false, reason: expect.stringContaining('--headroom-gb') })
  })
})
