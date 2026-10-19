import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DamagedRecordingError, readManifest, readRecording, verifyRecording } from './reader.js'
import type { Manifest, RecordingLine } from './format.js'

const manifest: Manifest = {
  format: 1,
  recording: 'r',
  instanceId: 'run-1',
  startedAt: 1_000,
  indi: { host: '127.0.0.1', port: 7624 },
  devices: [],
  limits: { queueBytes: 1, reserveBytes: 0 },
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cria-reader-'))
  await mkdir(join(dir, 'blobs'))
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
})

afterEach(() => rm(dir, { recursive: true, force: true }))

const msg = (n: number, t: number, extra: object = {}): RecordingLine => ({ k: 'msg', t, at: 1_000 + t, conn: 1, dir: 'in', n, xml: '<message/>', ...extra })
const end = (t: number): RecordingLine => ({ k: 'end', t, at: 1_000 + t })
const gap = (t: number): RecordingLine => ({ k: 'gap', t, at: 1_000 + t, reason: 'queue-full', dropped: { entries: 3, bytes: 900 } })
const traffic = (...lines: Array<RecordingLine | string>) => writeFile(join(dir, 'traffic.jsonl'), lines.map(line => `${typeof line === 'string' ? line : JSON.stringify(line)}\n`).join(''))

async function collect() {
  const lines: RecordingLine[] = []

  for await (const line of readRecording(dir)) lines.push(line)

  return lines
}

describe('a sound recording', () => {
  it('reads back in file order and verifies', async () => {
    await traffic(msg(0, 1), msg(1, 2), end(3))

    expect((await collect()).map(line => line.k)).toEqual(['msg', 'msg', 'end'])
    expect(await readManifest(dir)).toEqual(manifest)
    expect(await verifyRecording(dir)).toEqual({ valid: true, ended: true, tornTail: false, lines: 3, messages: 2, images: 0, gaps: [], problems: [], orphans: [] })
  })

  it('is valid without an end line: Cria died, which is not damage', async () => {
    await traffic(msg(0, 1))

    expect(await verifyRecording(dir)).toMatchObject({ valid: true, ended: false })
  })

  it('reports a gap and stays valid when nothing but the end follows it', async () => {
    await traffic(msg(0, 1), gap(2), end(3))

    const report = await verifyRecording(dir)

    expect(report.valid).toBe(true)
    expect(report.gaps).toEqual([gap(2)])
  })
})

describe('a torn last line', () => {
  it('is dropped by the reader and tolerated by verify, whatever bytes of the line survived', async () => {
    const whole = `${JSON.stringify(msg(1, 2))}\n`

    for (const kept of [1, 10, whole.length - 2, whole.length - 1]) {
      await writeFile(join(dir, 'traffic.jsonl'), `${JSON.stringify(msg(0, 1))}\n${whole.slice(0, kept)}`)

      expect((await collect()).map(line => (line.k === 'msg' ? line.n : -1))).toEqual([0])
      expect(await verifyRecording(dir)).toMatchObject({ valid: true, tornTail: true, lines: 1, ended: false })
    }
  })
})

describe('damage in the middle', () => {
  it('is refused by the reader and reported with its line number', async () => {
    await traffic(msg(0, 1), '{"k":"msg","t":2,"at":1002,"conn":1,"dir":"in","n":1,"xm', msg(2, 3))

    await expect(collect()).rejects.toThrow(DamagedRecordingError)
    expect(await verifyRecording(dir)).toMatchObject({ valid: false, problems: [{ kind: 'damaged-line', line: 2 }, { kind: 'message-skipped', line: 3, expected: 1, found: 2 }] })
  })

  it('catches a line that is valid JSON but not a recording line', async () => {
    await traffic(msg(0, 1), '{"k":"msg","t":-5}', msg(1, 3))

    expect((await verifyRecording(dir)).problems.map(problem => problem.kind)).toEqual(['damaged-line'])
  })

  it('catches a deleted line by the gap in its connection and direction count', async () => {
    await traffic(msg(0, 1), msg(2, 3), end(4))

    expect((await verifyRecording(dir)).problems).toEqual([{ kind: 'message-skipped', line: 2, conn: 1, dir: 'in', expected: 1, found: 2 }])
  })

  it('catches time running backwards, a line after a gap, and a line after the end', async () => {
    await traffic(msg(0, 5), msg(1, 4), gap(6), msg(2, 7), end(8), msg(3, 9))

    expect((await verifyRecording(dir)).problems).toEqual([
      { kind: 'time-went-back', line: 2 },
      { kind: 'line-after-gap', line: 4 },
      { kind: 'line-after-end', line: 6 },
    ])
  })

  it('catches an unreadable manifest', async () => {
    await writeFile(join(dir, 'manifest.json'), '{"format":2}')
    await traffic(msg(0, 1))

    expect((await verifyRecording(dir)).problems).toMatchObject([{ kind: 'bad-manifest' }])
  })
})

describe('images', () => {
  it('finds every referenced image, and reports files no line names without failing', async () => {
    await writeFile(join(dir, 'blobs', '1-0-0.blob'), 'x')
    await writeFile(join(dir, 'blobs', '1-5-0.blob.partial'), 'x')
    await traffic(msg(0, 1, { blobs: ['blobs/1-0-0.blob'] }))

    expect(await verifyRecording(dir)).toMatchObject({ valid: true, images: 1, orphans: ['blobs/1-5-0.blob.partial'] })
  })

  it('fails when a line names an image that is not there', async () => {
    await traffic(msg(0, 1, { blobs: ['blobs/1-0-0.blob'] }))

    expect((await verifyRecording(dir)).problems).toEqual([{ kind: 'missing-image', line: 1, path: 'blobs/1-0-0.blob' }])
  })

  it('refuses a line that names a path outside the blobs folder', async () => {
    await traffic(msg(0, 1, { blobs: ['../../etc/passwd'] }))

    expect((await verifyRecording(dir)).problems.map(problem => problem.kind)).toEqual(['damaged-line'])
  })
})
