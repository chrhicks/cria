/**
 * Recording of INDI traffic (docs/ts/SPEC.md, "Recording"), against the INDI
 * CCD simulator: what a recording of a real capture holds, that a stalled disk
 * never stops a capture, and that kill -9 at any moment leaves it readable.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openRecordingFiles, readRecording, verifyRecording, type RecordingFiles } from '@cria/recording'
import { startIndiServer, type RunningIndiServer } from '../../../testing/indiserver.js'
import { fitsToImageBytes } from '../src/image/fits.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const camera = { id: 'primary', kind: 'camera', indiDevice: 'CCD Simulator', connect: true } as const
const root = join(import.meta.dirname, '..', '..', '..')
let indi: RunningIndiServer
let directory: string
let cria: Cria | undefined
let child: ChildProcess | undefined

beforeAll(async () => {
  indi = await startIndiServer(['indi_simulator_ccd'])
})

afterAll(() => indi.stop())

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cria-recording-'))
})

afterEach(async () => {
  child?.kill('SIGKILL')
  child = undefined
  await cria?.stop()
  cria = undefined
  await rm(directory, { recursive: true, force: true })
})

const only = async (dir: string) => join(dir, (await readdir(dir))[0]!)

async function started(record: object, files?: (folder: string) => Promise<RecordingFiles>) {
  cria = await startCria(indi.port, [camera], { record: { dir: directory, ...record } }, { recording: { closeBudgetMs: 200, ...(files ? { files } : {}) } })
  await cria.waitFor(allReady(['primary']))

  return cria
}

describe('a capture against the CCD simulator, recorded', () => {
  it('records the frame Cria served: converting it again gives the same ImageBytes digest', async () => {
    const running = await started({ reserveGb: 0, queueMb: 64 })
    const capture = await running.run('primary', 'capture', { exposureSeconds: 0.5, light: true })

    expect(capture.kind).toBe('confirmed')
    await running.stop()
    cria = undefined

    const folder = await only(directory)
    const report = await verifyRecording(folder)
    const digests: string[] = []

    for await (const line of readRecording(folder)) {
      for (const path of line.k === 'msg' ? (line.blobs ?? []) : []) {
        digests.push(createHash('sha256').update(fitsToImageBytes(await readFile(join(folder, path)), { width: 1280, height: 1024 }).bytes).digest('hex'))
      }
    }

    expect(report).toMatchObject({ valid: true, ended: true, tornTail: false, gaps: [], orphans: [] })
    expect(report.images).toBe(1)
    expect(digests).toEqual([capture.image!.sha256])
  })

  it('records both directions from the first connection, with Cria\'s commands as it sent them', async () => {
    const running = await started({ reserveGb: 0, queueMb: 64 })

    await running.run('primary', 'capture', { exposureSeconds: 0.2, light: true })
    await running.stop()
    cria = undefined

    const sent: string[] = []
    const lines = []

    for await (const line of readRecording(await only(directory))) {
      lines.push(line)
      if (line.k === 'msg' && line.dir === 'out' && line.xml.includes('name="CCD_EXPOSURE"')) sent.push(line.xml)
    }

    expect(lines[0]).toMatchObject({ k: 'conn', conn: 1, status: 'connected' })
    expect(lines[1]).toMatchObject({ k: 'msg', conn: 1, dir: 'out', n: 0, xml: '<getProperties version="1.7"/>\n' })
    expect(lines.some(line => line.k === 'msg' && line.dir === 'in' && line.xml.startsWith('<defSwitchVector device="CCD Simulator" name="CONNECTION"'))).toBe(true)
    expect(sent).toEqual(['<newNumberVector device="CCD Simulator" name="CCD_EXPOSURE">\n  <oneNumber name="CCD_EXPOSURE_VALUE">0.2</oneNumber>\n</newNumberVector>\n'])
  })
})

describe('a stalled disk', () => {
  const stalled = async (folder: string): Promise<RecordingFiles> => {
    const real = await openRecordingFiles(folder)

    return { ...real, writeFile: (path, bytes) => (path.startsWith('blobs/') ? new Promise<void>(() => undefined) : real.writeFile(path, bytes)) }
  }

  it('does not stop captures from settling, and holds no more than queueMb', async () => {
    const running = await started({ reserveGb: 0, queueMb: 4 }, stalled)
    const recorder = running.service.rig.recorder!
    const kinds: string[] = []
    const peaks: number[] = []

    for (let i = 0; i < 3; i += 1) {
      kinds.push((await running.run('primary', 'capture', { exposureSeconds: 0.2, light: true })).kind)
      peaks.push(recorder.queuedBytes())
    }

    expect(kinds).toEqual(['confirmed', 'confirmed', 'confirmed'])
    expect(recorder.latched()).toBe('queue-full')
    expect(Math.max(...peaks)).toBeLessThanOrEqual(4 * 1024 ** 2)
    expect(recorder.queuedBytes()).toBeLessThan(4 * 1024 ** 2)
  })
})

describe('a configured recording that cannot open', () => {
  it('leaves Cria observing, with nothing recorded', async () => {
    const blocker = join(directory, 'not-a-directory')

    await writeFile(blocker, 'x')
    cria = await startCria(indi.port, [camera], { record: { dir: blocker, reserveGb: 0, queueMb: 4 } })
    await cria.waitFor(allReady(['primary']))

    expect(cria.service.rig.recorder).toBeUndefined()
    expect((await cria.run('primary', 'capture', { exposureSeconds: 0.2, light: true })).kind).toBe('confirmed')
  })
})

describe('kill -9 of the whole service', () => {
  async function killedAfter(delayMs: number) {
    const config = join(directory, 'cria.json')

    await writeFile(
      config,
      JSON.stringify({
        listen: { host: '127.0.0.1', port: 0 },
        indi: { host: '127.0.0.1', port: indi.port },
        imageDirectory: join(directory, 'images'),
        livenessMs: 500,
        devices: [camera],
        record: { dir: join(directory, 'recordings'), reserveGb: 0, queueMb: 64 },
      }),
    )

    const env = { ...process.env }

    delete env.CRIA_TOKEN
    const service = spawn(process.execPath, ['--conditions=@cria/source', '--import', join(root, 'testing', 'source-hook.mjs'), join(root, 'apps', 'cria', 'src', 'main.ts'), config], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env,
    })
    let log = ''

    child = service
    service.stderr!.on('data', chunk => void (log += String(chunk)))

    const port = await until('main.ts to print its port', () => /listening on (\d+)/.exec(log)?.[1], 15_000)
    const { makeCriaClient } = await import('../../../testing/cria-client.js')
    const client = makeCriaClient(`http://127.0.0.1:${port}`)
    const state = await until('the camera to be ready', async () => {
      const current = await client.state()

      return allReady(['primary'])(current) && current
    })
    const target = state.devices[0]!
    const exited = new Promise<NodeJS.Signals | null>(resolve => service.once('exit', (_, signal) => resolve(signal)))

    await client.submit({
      instanceId: state.instanceId,
      requestId: crypto.randomUUID(),
      deviceId: target.id,
      bindingId: target.bindingId,
      expectedName: target.name,
      kind: 'capture',
      parameters: { exposureSeconds: 0.3, light: true },
    } as never)
    await new Promise(resolve => setTimeout(resolve, delayMs))
    service.kill('SIGKILL')
    expect(await exited).toBe('SIGKILL')
    child = undefined

    return verifyRecording(await only(join(directory, 'recordings')))
  }

  // From before the exposure ends, through the frame's arrival, to after its line is written.
  it.each([0, 100, 350, 500, 650, 900, 1500])('leaves a recording that verifies when killed %i ms after a capture is submitted', async delayMs => {
    const report = await killedAfter(delayMs)

    expect(report).toMatchObject({ valid: true, ended: false, problems: [] })
    expect(report.messages).toBeGreaterThan(50)
  }, 60_000)
})
