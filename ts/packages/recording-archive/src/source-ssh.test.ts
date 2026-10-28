import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256File } from './files.js'
import { sshSource } from './source-ssh.js'

const name = '2026-03-01T04-00-00-11111111-1111-4111-8111-111111111111'
let root: string
let remote: string
let local: string

const source = () => sshSource({ spawnRemote: script => spawn('sh', ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] }), directory: remote })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cria-ssh-'))
  remote = join(root, "remote dir's")
  local = join(root, 'local')
  await mkdir(join(remote, name, 'blobs'), { recursive: true })
  await mkdir(local)
  await writeFile(join(remote, name, 'manifest.json'), '{}')
  await writeFile(join(remote, name, 'traffic.jsonl'), 'a\n')
  await writeFile(join(remote, name, 'blobs', '1-0-0.blob'), 'image')
  await utimes(join(remote, name, 'traffic.jsonl'), new Date(1_700_000_000_000), new Date(1_700_000_000_000))
})

afterEach(() => rm(root, { recursive: true, force: true }))

describe('the ssh source, with sh standing in for ssh', () => {
  it('lists sessions with the last write of traffic.jsonl and the pin', async () => {
    await mkdir(join(remote, 'not-a-session'))
    await symlink(join(remote, name), join(remote, 'link'))
    await writeFile(join(remote, name, 'keep'), 'x')

    expect(await source().list()).toEqual([
      { name, kind: 'folder', lastWriteMs: 1_700_000_000_000, pinned: true },
      { name: 'link', kind: 'symlink', lastWriteMs: expect.any(Number), pinned: true },
      expect.objectContaining({ name: 'not-a-session', kind: 'folder', pinned: false }),
    ])
  })

  it('takes an inventory, hashes named files and refuses a symlink inside a session', async () => {
    expect(await source().inventory(name)).toEqual([
      { path: 'blobs/1-0-0.blob', size: 5 },
      { path: 'manifest.json', size: 2 },
      { path: 'traffic.jsonl', size: 2 },
    ])

    const hashes = await source().hashes(name, ['traffic.jsonl', 'blobs/1-0-0.blob'])

    expect(hashes.get('traffic.jsonl')).toBe(await sha256File(join(remote, name, 'traffic.jsonl')))
    expect(hashes.size).toBe(2)

    await symlink('/etc/passwd', join(remote, name, 'blobs', 'x.blob'))
    await expect(source().inventory(name)).rejects.toThrow(/not a regular file/)
  })

  it('copies the session and deletes it through a .pruning rename', async () => {
    await source().fetch(name, join(local, 'staging'))
    expect(await readFile(join(local, 'staging', name, 'blobs', '1-0-0.blob'), 'utf8')).toBe('image')

    await source().remove(name)
    expect(await readdir(remote)).toEqual([])
  })

  it('refuses to delete when a .pruning entry already exists, and leaves both untouched', async () => {
    await mkdir(join(remote, `${name}.pruning`))
    await writeFile(join(remote, `${name}.pruning`, 'other-only-copy'), 'precious')

    await expect(source().remove(name)).rejects.toThrow(/already exists/)
    expect(await readFile(join(remote, `${name}.pruning`, 'other-only-copy'), 'utf8')).toBe('precious')
    expect(await readFile(join(remote, name, 'blobs', '1-0-0.blob'), 'utf8')).toBe('image')
  })

  it('refuses a name that is not a session folder before it reaches a shell', async () => {
    await expect(source().remove("x'; rm -rf /; '")).rejects.toThrow(/not a session folder name/)
    await expect(source().fetch('../etc', local)).rejects.toThrow(/not a session folder name/)
  })

  it('reports a remote failure with its message', async () => {
    await rm(remote, { recursive: true })
    await expect(source().list()).rejects.toThrow(/remote command failed/)
  })
})
