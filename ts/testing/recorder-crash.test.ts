import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { verifyRecording } from '../packages/recording/src/index.js'

const root = join(import.meta.dirname, '..')
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cria-crash-'))
})

afterEach(() => rm(dir, { recursive: true, force: true }))

function killedAt(step: string) {
  const child = spawn(
    process.execPath,
    ['--conditions=@cria/source', '--import', join(root, 'testing', 'source-hook.mjs'), join(root, 'testing', 'recorder-crash-child.ts'), dir, step],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let log = ''

  child.stderr.on('data', chunk => void (log += String(chunk)))

  return new Promise<NodeJS.Signals | null>((resolve, reject) => {
    child.once('exit', (code, signal) => (signal === null ? reject(new Error(`child exited ${code} at ${step}: ${log}`)) : resolve(signal)))
  })
}

async function recovered() {
  const [name] = await readdir(dir)

  return join(dir, name!)
}

// The write order is: image .partial, fsync, rename, fsync the folder, then the line.
const untouched = { valid: true, ended: false, tornTail: false, messages: 1, images: 0 }

it.each([
  { step: 'before-write', expected: { ...untouched, orphans: [] } },
  { step: 'mid-write', expected: { ...untouched, orphans: ['blobs/1-0-0.blob.partial'] } },
  { step: 'after-write', expected: { ...untouched, orphans: ['blobs/1-0-0.blob.partial'] } },
  { step: 'after-sync', expected: { ...untouched, orphans: ['blobs/1-0-0.blob.partial'] } },
  { step: 'after-rename', expected: { ...untouched, orphans: ['blobs/1-0-0.blob'] } },
  { step: 'after-sync-directory', expected: { ...untouched, orphans: ['blobs/1-0-0.blob'] } },
  { step: 'mid-append', expected: { ...untouched, tornTail: true, orphans: ['blobs/1-0-0.blob'] } },
  { step: 'after-append', expected: { valid: true, ended: false, tornTail: false, messages: 2, images: 1, orphans: [] } },
])('kill -9 at $step leaves a recording that verifies', async ({ step, expected }) => {
  expect(await killedAt(step)).toBe('SIGKILL')

  const folder = await recovered()

  expect(await verifyRecording(folder)).toMatchObject(expected)
  if (step === 'after-append') expect((await stat(join(folder, 'blobs', '1-0-0.blob'))).size).toBe(100_000)
})
