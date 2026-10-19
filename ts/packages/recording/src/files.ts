/**
 * The recorder's only contact with the disk, as one small interface so tests
 * can stall it, fill it or kill the process between two steps. Paths are
 * relative to the recording folder.
 */
import { mkdir, open, rename, statfs, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { blobsDirectory, trafficFile } from './format.js'

export interface RecordingFiles {
  /** Creates or replaces `path` with `bytes`. Does not flush. */
  readonly writeFile: (path: string, bytes: Buffer) => Promise<void>
  readonly syncFile: (path: string) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  /** Flushes a directory entry, so a rename survives power loss. `''` is the recording folder. */
  readonly syncDirectory: (path: string) => Promise<void>
  /** Appends `line` to the traffic file in one write. */
  readonly appendLine: (line: string) => Promise<void>
  readonly syncTraffic: () => Promise<void>
  /** Bytes a process may still write to the recording's filesystem. */
  readonly freeBytes: () => Promise<number>
  readonly close: () => Promise<void>
}

async function withHandle<A>(path: string, flags: string, use: (handle: FileHandle) => Promise<A>): Promise<A> {
  const handle = await open(path, flags)

  return use(handle).finally(() => handle.close())
}

/** Creates the recording folder and its blobs folder, and opens the traffic file for appending. */
export async function openRecordingFiles(folder: string): Promise<RecordingFiles> {
  await mkdir(join(folder, blobsDirectory), { recursive: true })
  const traffic = await open(join(folder, trafficFile), 'a')

  return {
    writeFile: (path, bytes) => withHandle(join(folder, path), 'w', handle => handle.writeFile(bytes)),
    syncFile: path => withHandle(join(folder, path), 'r', handle => handle.sync()),
    rename: (from, to) => rename(join(folder, from), join(folder, to)),
    syncDirectory: path => withHandle(join(folder, path), 'r', handle => handle.sync()),
    appendLine: async line => {
      await traffic.appendFile(line)
    },
    syncTraffic: () => traffic.sync(),
    freeBytes: async () => {
      const stats = await statfs(folder)

      return stats.bavail * stats.bsize
    },
    close: () => traffic.close(),
  }
}
