import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRecordingFiles, type RecordingFiles } from './files.js'
import { openRecorder, withRefs, type Recorder, type RecorderIdentity } from './recorder.js'
import { readManifest, readRecording, verifyRecording } from './reader.js'
import type { GapReason } from './format.js'

const identity: RecorderIdentity = {
  instanceId: 'run-1',
  indi: { host: '127.0.0.1', port: 7624 },
  devices: [{ id: 'primary', kind: 'camera', indiDevice: 'CCD Simulator' }],
}

let dir: string
let open: Recorder[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cria-recorder-'))
})

afterEach(async () => {
  await Promise.all(open.map(recorder => recorder.close()))
  open = []
  await rm(dir, { recursive: true, force: true })
})

const blobVector = '<setBLOBVector device="CCD Simulator" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="4" format=".fits"/></setBLOBVector>'

async function start(options: { queueBytes?: number; reserveBytes?: number; files?: (real: RecordingFiles) => RecordingFiles } = {}) {
  const latches: Array<[GapReason, string]> = []
  const wrap = options.files ?? (real => real)
  const recorder = await openRecorder(
    { dir, reserveBytes: options.reserveBytes ?? 0, queueBytes: options.queueBytes ?? 1024 * 1024 },
    identity,
    { files: async folder => wrap(await openRecordingFiles(folder)), onLatch: (reason, cause) => latches.push([reason, String(cause)]) },
  )

  open.push(recorder)

  return { recorder, latches }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

async function until(what: string, done: () => boolean) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > 3000) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('a recorder with a healthy disk', () => {
  it('writes the manifest once, then each entry in order, and ends cleanly', async () => {
    const { recorder } = await start()

    recorder.connection({ conn: 1, status: 'connected' })
    recorder.message({ conn: 1, dir: 'out', xml: '<getProperties version="1.7"/>\n', blobs: [] })
    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.from([1, 2, 3, 4])] })
    recorder.message({ conn: 1, dir: 'in', xml: '<message device="CCD Simulator" message="hi"/>', blobs: [] })
    await recorder.close()

    const lines = []

    for await (const line of readRecording(recorder.folder)) lines.push(line)

    expect(lines.map(line => line.k)).toEqual(['conn', 'msg', 'msg', 'msg', 'end'])
    expect(lines[2]).toMatchObject({
      k: 'msg',
      conn: 1,
      dir: 'in',
      n: 0,
      xml: '<setBLOBVector device="CCD Simulator" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="4" format=".fits" ref="blobs/1-0-0.blob"/></setBLOBVector>',
      blobs: ['blobs/1-0-0.blob'],
    })
    expect(lines.filter(line => line.k === 'msg').map(line => [line.dir, line.n])).toEqual([['out', 0], ['in', 0], ['in', 1]])
    expect([...(await readFile(join(recorder.folder, 'blobs', '1-0-0.blob')))]).toEqual([1, 2, 3, 4])
    expect(await readManifest(recorder.folder)).toMatchObject({
      format: 1,
      instanceId: 'run-1',
      indi: { host: '127.0.0.1', port: 7624 },
      limits: { queueBytes: 1024 * 1024, reserveBytes: 0 },
    })
    expect(await verifyRecording(recorder.folder)).toMatchObject({ valid: true, ended: true, tornTail: false, messages: 3, images: 1, gaps: [], orphans: [] })
  })

  it('leaves no .partial file and no temporary manifest behind', async () => {
    const { recorder } = await start()

    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(10)] })
    await recorder.close()

    expect((await readdir(recorder.folder)).sort()).toEqual(['blobs', 'manifest.json', 'traffic.jsonl'])
    expect(await readdir(join(recorder.folder, 'blobs'))).toEqual(['1-0-0.blob'])
  })

  it('writes nothing after close', async () => {
    const { recorder } = await start()

    await recorder.close()
    recorder.message({ conn: 1, dir: 'in', xml: '<message/>', blobs: [] })
    await settle()

    expect((await verifyRecording(recorder.folder)).messages).toBe(0)
  })
})

describe('withRefs', () => {
  it('names each elided payload in turn, whatever else the tag carries', () => {
    expect(withRefs('<x><oneBLOB name="A" size="1" len="1"/><oneBLOB name="B" size="2" format=".fits" /></x>', ['blobs/1-0-0.blob', 'blobs/1-0-1.blob'])).toBe(
      '<x><oneBLOB name="A" size="1" len="1" ref="blobs/1-0-0.blob"/><oneBLOB name="B" size="2" format=".fits" ref="blobs/1-0-1.blob"/></x>',
    )
  })

  it('leaves an element alone that has no path', () => {
    expect(withRefs('<oneBLOB name="A"/>', [])).toBe('<oneBLOB name="A"/>')
  })
})

describe('a stalled disk', () => {
  const stalled = (real: RecordingFiles): RecordingFiles => ({
    ...real,
    writeFile: (path, bytes) => (path.startsWith('blobs/') ? new Promise<void>(() => undefined) : real.writeFile(path, bytes)),
  })

  it('stops recording at the queue bound, frees the queue, and never lets queued bytes pass it', async () => {
    const { recorder, latches } = await start({ queueBytes: 10_000, files: stalled })
    const peak = { bytes: 0 }

    for (let i = 0; i < 50; i += 1) {
      recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(1000)] })
      peak.bytes = Math.max(peak.bytes, recorder.queuedBytes())
    }

    expect(recorder.latched()).toBe('queue-full')
    expect(peak.bytes).toBeLessThanOrEqual(10_000)
    expect(recorder.queuedBytes()).toBeLessThanOrEqual(1000 + blobVector.length + 256)
    expect(latches).toHaveLength(1)
    expect(latches[0]![0]).toBe('queue-full')
  })

  it('writes its gap line once the disk answers again, and nothing queued before it', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const { recorder } = await start({
      queueBytes: 5000,
      files: real => ({ ...real, writeFile: (path, bytes) => (path.startsWith('blobs/') ? held.then(() => real.writeFile(path, bytes)) : real.writeFile(path, bytes)) }),
    })

    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(1000)] })
    await settle()
    for (let i = 0; i < 19; i += 1) recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(1000)] })
    release()
    await recorder.close()

    const report = await verifyRecording(recorder.folder)

    expect(report).toMatchObject({ valid: true, ended: true, messages: 1, images: 1 })
    expect(report.gaps).toMatchObject([{ reason: 'queue-full', dropped: { entries: 19 } }])
  })

  it('refuses an entry larger than the whole queue at once', async () => {
    const { recorder } = await start({ queueBytes: 1000, files: stalled })

    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(5000)] })

    expect(recorder.latched()).toBe('queue-full')
    expect(recorder.queuedBytes()).toBe(0)
  })

  it('keeps taking offers in constant time once stopped', async () => {
    const { recorder } = await start({ queueBytes: 1000, files: stalled })

    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(5000)] })
    const before = performance.now()

    for (let i = 0; i < 100_000; i += 1) recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [] })

    expect(performance.now() - before).toBeLessThan(500)
    expect(recorder.queuedBytes()).toBe(0)
  })
})

describe('the disk filling up', () => {
  it('stops at the reserve, before the image that would breach it, and says so in a gap line', async () => {
    const { recorder, latches } = await start({ reserveBytes: 1000, files: real => ({ ...real, freeBytes: async () => 1500 }) })

    recorder.message({ conn: 1, dir: 'in', xml: '<message/>', blobs: [] })
    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(600)] })
    recorder.message({ conn: 1, dir: 'in', xml: '<message/>', blobs: [] })
    await until('recording to stop', () => recorder.latched() !== undefined)
    await recorder.close()

    expect(latches.map(([reason]) => reason)).toEqual(['low-disk'])

    const report = await verifyRecording(recorder.folder)

    expect(report).toMatchObject({ valid: true, ended: true, messages: 1, images: 0, orphans: [] })
    expect(report.gaps).toMatchObject([{ reason: 'low-disk', dropped: { entries: 2 } }])
  })

  it('stops on a failed image write with a gap line and no torn line', async () => {
    const { recorder } = await start({
      files: real => ({
        ...real,
        writeFile: async (path, bytes) => {
          if (!path.startsWith('blobs/')) return real.writeFile(path, bytes)

          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
        },
      }),
    })

    recorder.message({ conn: 1, dir: 'in', xml: '<message/>', blobs: [] })
    recorder.message({ conn: 1, dir: 'in', xml: blobVector, blobs: [Buffer.alloc(10)] })
    recorder.message({ conn: 1, dir: 'in', xml: '<message/>', blobs: [] })
    await until('recording to stop', () => recorder.latched() !== undefined)
    await recorder.close()

    const report = await verifyRecording(recorder.folder)

    expect(recorder.latched()).toBe('io-error')
    expect(report).toMatchObject({ valid: true, ended: true, messages: 1, tornTail: false })
    expect(report.gaps.map(gap => gap.reason)).toEqual(['io-error'])
  })

  it('writes nothing after an append that may have left a torn line', async () => {
    const { recorder } = await start({
      files: real => ({
        ...real,
        appendLine: async line => {
          await real.appendLine(line.slice(0, 20))
          throw new Error('EIO: i/o error')
        },
      }),
    })

    recorder.message({ conn: 1, dir: 'in', xml: '<message/>', blobs: [] })
    await until('recording to stop', () => recorder.latched() !== undefined)
    await recorder.close()

    const text = await readFile(join(recorder.folder, 'traffic.jsonl'), 'utf8')

    expect(text.split('\n')).toHaveLength(1)
    expect(await verifyRecording(recorder.folder)).toMatchObject({ valid: true, ended: false, tornTail: true, lines: 0 })
  })
})

describe('the recorder cannot hurt its caller', () => {
  it('stops recording instead of throwing when an entry cannot be built', async () => {
    const { recorder } = await start()
    const broken = { conn: 1, dir: 'in', get xml(): string { throw new Error('boom') }, blobs: [] } as const

    expect(() => recorder.message(broken as never)).not.toThrow()
    expect(recorder.latched()).toBe('io-error')
  })
})
