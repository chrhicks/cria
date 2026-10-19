/**
 * Test support: records a few entries, one with an image, and kills its own
 * process with SIGKILL at the named step of the write order. Run by
 * recorder-crash.test.ts; never imported.
 */
import { openRecorder, openRecordingFiles, type RecordingFiles } from '../packages/recording/src/index.js'

const [dir, step] = process.argv.slice(2)
const image = Buffer.alloc(100_000, 7)
const isImage = (path: string) => /^blobs\/[^/]+\.blob(\.partial)?$/.test(path)
const die = (): never => {
  process.kill(process.pid, 'SIGKILL')

  return undefined as never
}

function crashing(real: RecordingFiles): RecordingFiles {
  return {
    ...real,
    writeFile: async (path, bytes) => {
      if (!isImage(path)) return real.writeFile(path, bytes)
      if (step === 'before-write') die()
      if (step === 'mid-write') {
        await real.writeFile(path, bytes.subarray(0, bytes.length / 2))
        die()
      }

      await real.writeFile(path, bytes)
      if (step === 'after-write') die()
    },
    syncFile: async path => {
      await real.syncFile(path)
      if (isImage(path) && step === 'after-sync') die()
    },
    rename: async (from, to) => {
      await real.rename(from, to)
      if (isImage(to) && step === 'after-rename') die()
    },
    syncDirectory: async path => {
      await real.syncDirectory(path)
      if (path === 'blobs' && step === 'after-sync-directory') die()
    },
    appendLine: async line => {
      if (!line.includes('"blobs"')) return real.appendLine(line)
      if (step === 'mid-append') {
        await real.appendLine(line.slice(0, line.length / 2))
        die()
      }

      await real.appendLine(line)
      if (step === 'after-append') die()
    },
  }
}

const recorder = await openRecorder(
  { dir: dir!, reserveBytes: 0, queueBytes: 10_000_000 },
  { instanceId: 'crash', indi: { host: '127.0.0.1', port: 7624 }, devices: [] },
  { files: async folder => crashing(await openRecordingFiles(folder)) },
)

recorder.connection({ conn: 1, status: 'connected' })
recorder.message({ conn: 1, dir: 'out', xml: '<getProperties version="1.7"/>\n', blobs: [] })
recorder.message({ conn: 1, dir: 'in', xml: '<setBLOBVector device="C" name="CCD1"><oneBLOB name="CCD1" size="100000" format=".fits"/></setBLOBVector>', blobs: [image] })
recorder.message({ conn: 1, dir: 'in', xml: '<message device="C" message="after"/>', blobs: [] })

await new Promise(() => setInterval(() => undefined, 1000))
