/**
 * Where a finished session is copied from: errai, or a folder on this machine standing in for it.
 * One small interface, so the whole pipeline runs in tests on a temp folder with no ssh.
 * The rules for what may leave the source are the stage-1 prune rules (`ts/deploy/recording-prune.mjs`).
 */
import { cp, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { ArchiveError, hashFiles, ifMissing, listFiles, type SourceFile } from './files.js'

export const sessionName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const pinFile = 'keep'
export const pruningSuffix = '.pruning'

export interface SourceEntry {
  readonly name: string
  readonly kind: 'folder' | 'symlink' | 'other'
  /** Epoch milliseconds of the last write to `traffic.jsonl` (the folder's own time without one). */
  readonly lastWriteMs: number
  readonly pinned: boolean
}

export interface Source {
  /** The folder on this machine that holds the sessions, for a local source; none for ssh. */
  readonly directory?: string
  /** The direct children of the recording folder. */
  readonly list: () => Promise<ReadonlyArray<SourceEntry>>
  /** Every file in the session, with its size. Throws on anything that is not a regular file. */
  readonly inventory: (name: string) => Promise<ReadonlyArray<SourceFile>>
  /** sha256 of each named file, computed where the files are. */
  readonly hashes: (name: string, paths: ReadonlyArray<string>) => Promise<ReadonlyMap<string, string>>
  /** Copies the session to `<into>/<name>`. Never changes the source. */
  readonly fetch: (name: string, into: string) => Promise<void>
  /** Deletes the session: a rename to `<name>.pruning` first, so a crash never leaves a half folder that looks like a session. */
  readonly remove: (name: string) => Promise<void>
}

export interface Policy {
  readonly minAgeMs: number
  readonly liveWindowMs: number
}

export type Protection = 'missing' | 'not-a-session' | 'open' | 'pinned' | 'young'

/**
 * Why a session must not be deleted, or undefined. The same rules as stage 1: the newest session and any
 * written in the live window are the one Cria has open, a `keep` file pins one, and one younger than the
 * floor stays. `open` also stops archiving: a copy of a growing folder would not match.
 */
export function protection(entries: ReadonlyArray<SourceEntry>, name: string, now: number, policy: Policy): Protection | undefined {
  const entry = entries.find(candidate => candidate.name === name)

  if (!entry) return 'missing'
  if (entry.kind !== 'folder' || !sessionName.test(name)) return 'not-a-session'

  const newest = entries.filter(candidate => candidate.kind === 'folder' && sessionName.test(candidate.name)).reduce((latest, candidate) => (candidate.name > latest ? candidate.name : latest), '')
  const age = now - entry.lastWriteMs

  if (name === newest || age < policy.liveWindowMs) return 'open'
  if (entry.pinned) return 'pinned'
  if (age < policy.minAgeMs) return 'young'

  return undefined
}

export function assertSessionName(name: string): void {
  if (!sessionName.test(name)) throw new ArchiveError(`${name} is not a session folder name`)
}

/** A folder on this machine as the source. Tests use it as errai; `--source-dir` uses it to rehearse on a copy. */
export function localSource(directory: string): Source {
  const path = (name: string) => {
    assertSessionName(name)

    return join(directory, name)
  }

  return {
    directory,
    list: async () => {
      const entries: SourceEntry[] = []

      for (const name of (await readdir(directory)).sort()) {
        const info = await lstat(join(directory, name))
        const traffic = await lstat(join(directory, name, 'traffic.jsonl')).then(stat => stat, ifMissing)

        entries.push({
          name,
          kind: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'folder' : 'other',
          lastWriteMs: (traffic ?? info).mtimeMs,
          pinned: info.isDirectory() && (await lstat(join(directory, name, pinFile)).then(() => true, error => ifMissing(error) ?? false)),
        })
      }

      return entries
    },
    inventory: async name => listFiles(path(name)),
    hashes: async (name, paths) => hashFiles(path(name), paths),
    fetch: async (name, into) => {
      await mkdir(into, { recursive: true })
      await cp(path(name), join(into, name), { recursive: true, errorOnExist: true, force: false })
    },
    remove: async name => {
      const doomed = `${path(name)}${pruningSuffix}`

      await rename(path(name), doomed)
      await rm(doomed, { recursive: true, force: true })
    },
  }
}

/**
 * A local source must not overlap staging or the archive: the run removes stale staging folders and replaces
 * archive files, and either would then reach the source itself. Compared by real path, so a symlink does not hide it.
 */
export async function assertSeparate(sourceDirectory: string, others: Readonly<Record<string, string>>): Promise<void> {
  const source = await realpath(sourceDirectory)
  const inside = (parent: string, child: string) => {
    const path = relative(parent, child)

    return path === '' || (!path.startsWith('..') && !path.startsWith('/'))
  }

  for (const [label, directory] of Object.entries(others)) {
    const real = await realpath(directory)

    if (inside(source, real) || inside(real, source)) throw new ArchiveError(`the ${label} folder ${directory} overlaps the source folder ${sourceDirectory}`)
  }
}
