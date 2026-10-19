/**
 * Measures what recording costs Cria's event loop, healthy and with a stalled
 * disk. Not a test: run it by hand and read the table.
 *
 *   node --conditions=@cria/source --import ./testing/source-hook.mjs testing/measure-recording-stall.ts <directory on the disk to test> [seconds]
 *
 * The stall is real: the image's `.partial` file is a FIFO nobody reads, so the
 * recorder's open() blocks a libuv thread-pool thread for good, as a hung disk
 * does. Load is 1000 small messages a second and a 52 MB image every 3 s, which
 * is the bulk of what a ZWO ASI2600 night sends. Each image is a fresh, filled
 * buffer, as the framer's decode makes one, so resident memory is honest; every
 * scenario pays for the allocation, the one with no recorder included.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { join } from 'node:path'
import { openRecorder } from '../packages/recording/src/index.js'

const [base, secondsArgument] = process.argv.slice(2)

if (!base) throw new Error('usage: measure-recording-stall.ts <directory> [seconds]')
const seconds = Number(secondsArgument ?? 20)
const imageBytes = 52 * 1024 * 1024
const wire = `<defNumberVector device="ZWO CCD ASI2600MC Pro" name="CCD_TEMPERATURE" label="Temperature" group="Main Control" state="Ok" perm="ro"><defNumber name="CCD_TEMPERATURE_VALUE" label="Temperature (C)" format="%5.2f" min="-50" max="50" step="0">-10.1</defNumber></defNumberVector>`
const blobWire = '<setBLOBVector device="ZWO CCD ASI2600MC Pro" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="52164864" format=".fits"/></setBLOBVector>'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const ms = (nanoseconds: number) => Math.round(nanoseconds / 1e4) / 100

interface Row {
  scenario: string
  loopP50: number
  loopP99: number
  loopMax: number
  otherWriteP50: number
  otherWriteMax: number
  rssPeakMb: number
  latched: string
  imagesOnDisk: number
}

async function scenario(name: 'no recorder' | 'healthy disk' | 'stalled disk (blocked open on a FIFO)'): Promise<Row> {
  const dir = mkdtempSync(join(base, 'cria-stall-'))
  const queueBytes = 256 * 1024 ** 2
  const recorder =
    name === 'no recorder' ? undefined : await openRecorder({ dir, reserveBytes: 0, queueBytes }, { instanceId: 'measure', indi: { host: '127.0.0.1', port: 7624 }, devices: [] })

  if (recorder && name !== 'healthy disk')
    for (let n = 1; n <= 40; n += 1) execFileSync('mkfifo', [join(recorder.folder, 'blobs', `${100 + n}-0-0.blob.partial`)])

  const loop = monitorEventLoopDelay({ resolution: 1 })
  const writes: number[] = []
  const otherDir = mkdtempSync(join(base, 'cria-other-'))
  let rssPeak = 0
  let conn = 0
  const stop = { now: false }

  loop.enable()

  const traffic = setInterval(() => {
    for (let i = 0; i < 10; i += 1) recorder?.message({ conn: 1, dir: 'in', xml: wire, blobs: [] })
  }, 10)
  const frames = setInterval(() => {
    conn += 1
    if (!recorder) Buffer.alloc(imageBytes, 1)
    recorder?.message({ conn: 100 + conn, dir: 'in', xml: blobWire, blobs: [Buffer.alloc(imageBytes, 1)] })
  }, 3000)
  const sampling = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss)
  }, 100)
  const otherWork = (async () => {
    // Cria's other file work: a small write that is flushed, as the image store does.
    while (!stop.now) {
      const started = performance.now()
      const handle = await open(join(otherDir, 'probe'), 'w')

      await writeFile(handle, 'x'.repeat(4096))
      await handle.sync()
      await handle.close()
      writes.push(performance.now() - started)
      await sleep(100)
    }
  })()

  await sleep(seconds * 1000)
  stop.now = true
  clearInterval(traffic)
  clearInterval(frames)
  clearInterval(sampling)
  await otherWork
  loop.disable()

  const sorted = writes.sort((a, b) => a - b)
  const row: Row = {
    scenario: name,
    loopP50: ms(loop.percentile(50)),
    loopP99: ms(loop.percentile(99)),
    loopMax: ms(loop.max),
    otherWriteP50: Math.round(sorted[Math.floor(sorted.length / 2)]! * 100) / 100,
    otherWriteMax: Math.round(sorted.at(-1)! * 100) / 100,
    rssPeakMb: Math.round(rssPeak / 1024 ** 2),
    latched: recorder ? (recorder.latched() ?? 'no') : 'n/a',
    imagesOnDisk: recorder ? Number(execFileSync('sh', ['-c', `ls ${recorder.folder}/blobs | grep -c '[.]blob$' || true`]).toString().trim()) : 0,
  }

  if (recorder) {
    if (name === 'stalled disk (blocked open on a FIFO)') {
      // A stalled disk never lets close finish; the rig abandons it.
      await recorder.abandon()
    } else {
      await recorder.close()
    }
  }

  rmSync(otherDir, { recursive: true, force: true })
  // Unblock the thread-pool threads parked on the FIFOs so the process can exit.
  if (recorder && name !== 'healthy disk') execFileSync('sh', ['-c', `for n in $(seq 101 140); do timeout 1 cat "${recorder.folder}/blobs/$n-0-0.blob.partial" > /dev/null 2>&1; done; true`])
  rmSync(dir, { recursive: true, force: true })

  return row
}

const rows: Row[] = []

for (const name of ['no recorder', 'healthy disk', 'stalled disk (blocked open on a FIFO)'] as const) rows.push(await scenario(name))

console.table(rows)
process.exit(0)
