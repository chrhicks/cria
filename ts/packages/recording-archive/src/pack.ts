/** tar + zstd, run as child processes so no archive is held in memory. */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ArchiveError, sha256File } from './files.js'

function watch(child: ChildProcess, what: string): Promise<void> {
  let err = ''

  child.stderr?.on('data', chunk => void (err += chunk))

  return once(child, 'close').then(([code]) => {
    if (code !== 0) throw new ArchiveError(`${what} failed (exit ${code}): ${err.trim().slice(0, 300)}`)
  })
}

/** `<parent>/<name>` into one zstd-compressed tar at `file`. */
export async function pack(parent: string, name: string, file: string): Promise<void> {
  const tar = spawn('tar', ['-C', parent, '-cf', '-', name], { stdio: ['ignore', 'pipe', 'pipe'] })
  const zstd = spawn('zstd', ['-q', '-T0', '-f', '-o', file], { stdio: ['pipe', 'ignore', 'pipe'] })
  const done = Promise.all([watch(tar, 'tar'), watch(zstd, 'zstd')])

  await pipeline(tar.stdout!, zstd.stdin!)
  await done
}

/** Unpacks into `into`, which must exist. */
export async function unpack(file: string, into: string): Promise<void> {
  const zstd = spawn('zstd', ['-q', '-d', '-c', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  const tar = spawn('tar', ['-xf', '-', '-C', into], { stdio: ['pipe', 'ignore', 'pipe'] })
  const done = Promise.all([watch(zstd, 'zstd'), watch(tar, 'tar')])

  await pipeline(zstd.stdout!, tar.stdin!)
  await done
}

/** Moves a file, by rename when both sides share a filesystem and by a hashed copy when not. The result replaces `to`. */
export async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })

  const renamed = await rename(from, to).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EXDEV') throw error

      return false
    },
  )

  if (renamed) return

  const partial = `${to}.partial`

  await copyFile(from, partial)
  if ((await sha256File(partial)) !== (await sha256File(from))) throw new ArchiveError(`copy of ${from} to ${to} does not match`)
  await rename(partial, to)
  await rm(from)
}
