#!/usr/bin/env node
// recording-prune: keeps free space on errai above Cria's recording reserve.
//
// Cria's recorder stops for the rest of a run when free space would drop below
// `record.reserveGb`, and never resumes. This script, run daily by a systemd user
// timer, deletes whole session folders under `record.dir`, oldest first, until free
// space is back at reserve + headroom (default 60 GB). It never touches:
//
//   - the newest session, or any session written in the last 30 minutes (Cria has it open),
//   - a session younger than 3 days (by the mtime of `traffic.jsonl`),
//   - a session holding a file named `keep` (`touch <session>/keep` pins it),
//   - anything that is not a session folder (name pattern, `format: 1` manifest, not a symlink).
//
// It only reports unless given `--apply`. Every run writes a status file
// (`$XDG_STATE_HOME/cria/recording-prune.json`) and logs the same to the journal.
// `ok: false` means free space is short of the target and nothing more can go.
// docs/runtime.md has the install steps. Node built-ins only; `planPrune` is pure.
import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const GiB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000

export const defaults = {
  headroomGb: 60,
  minAgeDays: 3,
  liveWindowMs: 30 * 60 * 1000,
}

const sessionName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const pruningSuffix = '.pruning'
export const pinFile = 'keep'

/**
 * What the filesystem layer saw in `record.dir`, one per direct child.
 * @typedef {{ name: string, isDirectory: boolean, isSymlink: boolean, manifestOk: boolean, bytes: number, lastWriteMs: number, pinned: boolean }} Entry
 * @typedef {{ headroomBytes: number, minAgeMs: number, liveWindowMs: number }} Policy
 * @typedef {{ name: string, bytes: number }} Pick
 * @typedef {{ remove: Pick[], skipped: Array<{ name: string, bytes: number, reason: 'open' | 'young' | 'pinned' }>, ignored: string[], freeBytes: number, targetBytes: number, freeAfterBytes: number, ok: boolean, reason?: string }} Plan
 */

/**
 * Decides which sessions to delete. Pure: the same entries, free space and clock
 * always give the same plan.
 *
 * @param {{ entries: Entry[], freeBytes: number, reserveBytes: number, now: number, policy: Policy }} input
 * @returns {Plan}
 */
export function planPrune({ entries, freeBytes, reserveBytes, now, policy }) {
  const targetBytes = reserveBytes + policy.headroomBytes
  const sessions = entries.filter(entry => entry.isDirectory && !entry.isSymlink && entry.manifestOk && sessionName.test(entry.name))
  const ignored = entries.filter(entry => !sessions.includes(entry)).map(entry => entry.name)
  const newest = sessions.reduce((latest, entry) => (latest === undefined || entry.name > latest ? entry.name : latest), undefined)
  const remove = []
  const skipped = []
  let free = freeBytes

  for (const entry of [...sessions].sort((a, b) => a.lastWriteMs - b.lastWriteMs || (a.name < b.name ? -1 : 1))) {
    const age = now - entry.lastWriteMs
    const reason = entry.name === newest || age < policy.liveWindowMs ? 'open' : entry.pinned ? 'pinned' : age < policy.minAgeMs ? 'young' : undefined

    if (reason) skipped.push({ name: entry.name, bytes: entry.bytes, reason })
    else if (free < targetBytes) {
      remove.push({ name: entry.name, bytes: entry.bytes })
      free += entry.bytes
    }
  }

  const ok = free >= targetBytes
  const kept = ['open', 'pinned', 'young'].flatMap(reason => {
    const count = skipped.filter(entry => entry.reason === reason).length

    return count > 0 ? [`${count} ${reason}`] : []
  })

  return {
    remove,
    skipped,
    ignored,
    freeBytes,
    targetBytes,
    freeAfterBytes: free,
    ok,
    ...(ok ? {} : { reason: `short of the target by ${gb(targetBytes - free)} GB with ${remove.length} sessions selected; kept: ${kept.length ? kept.join(', ') : 'none'}` }),
  }
}

export const gb = bytes => Math.round((bytes / GiB) * 10) / 10

/** Bytes on disk (allocated blocks, so a sparse file counts what it holds), without following symlinks. */
async function treeBytes(path) {
  const info = await lstat(path)

  if (!info.isDirectory()) return info.blocks * 512

  let total = info.blocks * 512

  for (const child of await readdir(path)) total += await treeBytes(join(path, child))

  return total
}

async function manifestOk(path, name) {
  try {
    const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'))

    return manifest?.format === 1 && manifest.recording === name
  } catch {
    return false
  }
}

async function lastWrite(path) {
  try {
    return (await lstat(join(path, 'traffic.jsonl'))).mtimeMs
  } catch {
    return (await lstat(path)).mtimeMs
  }
}

/** @returns {Promise<Entry[]>} */
export async function scan(dir) {
  const entries = []

  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name)
    const info = await lstat(path)
    const isDirectory = info.isDirectory()
    const isSymlink = info.isSymbolicLink()
    const candidate = isDirectory && sessionName.test(name)

    entries.push({
      name,
      isDirectory,
      isSymlink,
      manifestOk: candidate && (await manifestOk(path, name)),
      bytes: candidate ? await treeBytes(path) : 0,
      lastWriteMs: candidate ? await lastWrite(path) : info.mtimeMs,
      pinned: candidate && existsSync(join(path, pinFile)),
    })
  }

  return entries
}

/**
 * A rename to `<name>.pruning` first, so a crash never leaves a half-deleted folder that looks like a session.
 * The scan can be minutes old (it sizes every blob), so the checks run again here: Chris may have pinned the
 * session since, and `root` must still be the folder the scan read.
 */
async function removeSession(root, dir, name) {
  const path = join(root, name)

  if ((await realpath(dir)) !== root) throw new Error(`${dir} no longer resolves to ${root}; not deleting`)

  const info = await lstat(path)

  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('no longer a plain folder; not deleting')
  if (!(await manifestOk(path, name))) throw new Error('manifest changed since the scan; not deleting')
  if (existsSync(join(path, pinFile))) throw new Error('pinned since the scan; not deleting')

  const doomed = `${path}${pruningSuffix}`

  await rename(path, doomed)
  await rm(doomed, { recursive: true, force: true })
}

/** Leftovers of a run that crashed between the rename and the remove. */
export async function pendingRemovals(dir) {
  const names = await readdir(dir)

  return names.filter(name => name.endsWith(pruningSuffix) && sessionName.test(name.slice(0, -pruningSuffix.length)))
}

export const freeBytesOf = async dir => {
  const stats = await statfs(dir)

  return stats.bavail * stats.bsize
}

/**
 * One run. Effects are injected so the tests can drive it on a temp dir.
 *
 * @param {{ dir: string, reserveBytes: number, apply: boolean, policy: Policy, now: () => number, freeBytes?: (dir: string) => Promise<number>, log: (line: string) => void }} options
 */
export async function prune({ dir, reserveBytes, apply, policy, now, freeBytes = freeBytesOf, log }) {
  const mode = apply ? 'apply' : 'dry-run'
  const root = await realpath(dir)
  const leftovers = await pendingRemovals(root)

  const finished = []
  const pinnedLeftovers = []

  for (const name of leftovers) {
    const path = join(root, name)

    if (existsSync(join(path, pinFile))) {
      log(`keeping ${name}: pinned, left over from a failed delete`)
      pinnedLeftovers.push({ name, gb: gb(await treeBytes(path)), reason: 'pinned' })
      continue
    }

    log(`${apply ? 'finishing' : 'would finish'} removal of ${name}`)
    if (apply) {
      await rm(path, { recursive: true, force: true })
      finished.push(name)
    }
  }

  const plan = planPrune({ entries: await scan(root), freeBytes: await freeBytes(root), reserveBytes, now: now(), policy })
  const deleted = []
  const errors = []

  for (const pick of plan.remove) {
    log(`${apply ? 'deleting' : 'would delete'} ${pick.name} (${gb(pick.bytes)} GB)`)
    if (!apply) continue

    try {
      await removeSession(root, dir, pick.name)
      deleted.push(pick)
    } catch (error) {
      errors.push(`${pick.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const skip of plan.skipped) log(`keeping ${skip.name} (${gb(skip.bytes)} GB): ${skip.reason}`)
  for (const name of plan.ignored) log(`ignoring ${name}: not a session folder`)

  const freeAfterBytes = apply ? await freeBytes(root) : plan.freeAfterBytes
  const measuredBytes = apply ? freeAfterBytes : plan.freeBytes
  const ok = measuredBytes >= plan.targetBytes && errors.length === 0
  const reason = ok
    ? undefined
    : errors.length
      ? `could not delete: ${errors.join('; ')}`
      : !plan.ok
        ? plan.reason
        : apply
          ? `free space is ${gb(freeAfterBytes)} GB after deleting, target ${gb(plan.targetBytes)} GB`
          : `free space is ${gb(plan.freeBytes)} GB, below the target ${gb(plan.targetBytes)} GB; dry run, so nothing was deleted (it would delete ${plan.remove.length})`
  const asRow = pick => ({ name: pick.name, gb: gb(pick.bytes) })

  return {
    at: new Date(now()).toISOString(),
    mode,
    ok,
    ...(reason && { reason }),
    dir,
    freeGb: gb(plan.freeBytes),
    freeAfterGb: gb(freeAfterBytes),
    targetGb: gb(plan.targetBytes),
    deleted: deleted.map(asRow),
    wouldDelete: apply ? [] : plan.remove.map(asRow),
    kept: [...plan.skipped.map(skip => ({ name: skip.name, gb: gb(skip.bytes), reason: skip.reason })), ...pinnedLeftovers],
    finishedLeftovers: finished,
  }
}

export const defaultStatePath = environment => join(environment.XDG_STATE_HOME || join(homedir(), '.local/state'), 'cria/recording-prune.json')

/** Reads `record` from Cria's rig config, so the script cannot drift from what Cria uses. */
export function readRecordConfig(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'))
  const record = json?.record

  if (record === undefined) return undefined
  if (typeof record.dir !== 'string' || record.dir === '' || typeof record.reserveGb !== 'number') throw new Error('record needs dir and reserveGb')

  return { dir: record.dir, reserveBytes: record.reserveGb * GiB }
}

export async function writeStatus(path, status) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(status, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      config: { type: 'string' },
      state: { type: 'string' },
      'headroom-gb': { type: 'string', default: String(defaults.headroomGb) },
      'min-age-days': { type: 'string', default: String(defaults.minAgeDays) },
    },
    strict: true,
  })
  const configPath = values.config ?? process.env.CRIA_CONFIG ?? join(homedir(), '.config/cria/rig.json')
  const statePath = values.state ?? defaultStatePath(process.env)
  const headroomGb = Number(values['headroom-gb'])
  const minAgeDays = Number(values['min-age-days'])
  const log = line => console.log(`recording-prune: ${line}`)
  const mode = values.apply ? 'apply' : 'dry-run'
  const fail = async (reason, code) => {
    console.error(`recording-prune: ${reason}`)
    await writeStatus(statePath, { at: new Date().toISOString(), mode, ok: false, reason, deleted: [], wouldDelete: [], kept: [] }).catch(() => undefined)
    process.exit(code)
  }
  let record

  if (!(headroomGb >= 0) || !(minAgeDays >= 0)) await fail('--headroom-gb and --min-age-days must be numbers of at least 0', 2)

  try {
    record = readRecordConfig(configPath)
  } catch (error) {
    await fail(`${configPath}: ${error instanceof Error ? error.message : String(error)}`, 2)
  }

  if (!record) {
    log(`${configPath} has no record section; nothing to prune`)
    await writeStatus(statePath, { at: new Date().toISOString(), mode, ok: true, reason: 'recording is off in the config', deleted: [], wouldDelete: [], kept: [] })

    return
  }

  let status

  try {
    status = await prune({
      dir: record.dir,
      reserveBytes: record.reserveBytes,
      apply: values.apply,
      policy: { headroomBytes: headroomGb * GiB, minAgeMs: minAgeDays * DAY_MS, liveWindowMs: defaults.liveWindowMs },
      now: Date.now,
      log,
    })
  } catch (error) {
    await fail(`failed: ${error instanceof Error ? error.message : String(error)}`, 1)
  }

  await writeStatus(statePath, status)
  log(`${status.mode}: free ${status.freeGb} GB, target ${status.targetGb} GB, ${status.mode === 'apply' ? `deleted ${status.deleted.length}` : `would delete ${status.wouldDelete.length}`}; free after ${status.freeAfterGb} GB`)
  if (!status.ok) log(`WARNING: target not reached: ${status.reason}`)
  log(`status written to ${statePath}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(`recording-prune: failed: ${error instanceof Error ? error.stack : String(error)}`)
    process.exit(1)
  })
}
