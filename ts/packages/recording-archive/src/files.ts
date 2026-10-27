/** Plain-file helpers shared by the sources and the staging checks. Paths are relative to a session folder, with `/` separators. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface SourceFile {
  readonly path: string
  readonly size: number
}

export class ArchiveError extends Error {
  override readonly name = 'ArchiveError'
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')

  for await (const chunk of createReadStream(path)) hash.update(chunk)

  return hash.digest('hex')
}

/** Every regular file under `root`. A symlink, device or other special file is refused: a session holds none. */
export async function listFiles(root: string, relative = ''): Promise<SourceFile[]> {
  const files: SourceFile[] = []

  for (const name of (await readdir(join(root, relative))).sort()) {
    const path = relative === '' ? name : `${relative}/${name}`
    const info = await lstat(join(root, path))

    if (info.isDirectory()) files.push(...(await listFiles(root, path)))
    else if (info.isFile()) files.push({ path, size: info.size })
    else throw new ArchiveError(`${path} is not a regular file or folder`)
  }

  return files
}

export async function hashFiles(root: string, paths: ReadonlyArray<string>): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()

  for (const path of paths) hashes.set(path, await sha256File(join(root, path)))

  return hashes
}

/** The differences between two file lists, for a message. Empty means equal. */
export function differences(expected: ReadonlyArray<SourceFile>, found: ReadonlyArray<SourceFile>): string[] {
  const have = new Map(found.map(file => [file.path, file.size]))
  const want = new Map(expected.map(file => [file.path, file.size]))
  const problems: string[] = []

  for (const [path, size] of want) {
    if (!have.has(path)) problems.push(`${path} is missing`)
    else if (have.get(path) !== size) problems.push(`${path} is ${have.get(path)} bytes, expected ${size}`)
  }
  for (const path of have.keys()) if (!want.has(path)) problems.push(`${path} is extra`)

  return problems
}

export function differentHashes(expected: ReadonlyMap<string, string>, found: ReadonlyMap<string, string>): string[] {
  return [...expected].flatMap(([path, hash]) => (found.get(path) === hash ? [] : [path]))
}

/** For `.then(read, ifMissing)`: a file that is not there is `undefined`; any other failure still throws. */
export function ifMissing(error: unknown): undefined {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined

  throw error
}
