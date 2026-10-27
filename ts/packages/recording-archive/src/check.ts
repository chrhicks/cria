/**
 * The unpacked archive must stand alone: Cria's recording check passes on it and a short replay serves its
 * first frame. A kept frame is delivered as the file's own bytes; a pruned one is answered with an Alert.
 */
import { once } from 'node:events'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { loadTape, startReplay } from '@cria/indi-replay'
import { verifyRecording } from '@cria/recording'
import { ArchiveError } from './files.js'

export interface CheckResult {
  readonly images: number
  readonly prunedImages: number
  /** The frame the short replay served: kept (its bytes arrived) or pruned (Alert); none for a session with no images. */
  readonly replayed?: { readonly index: number; readonly pruned: boolean }
}

const exposureSeconds = 0.05

async function replayFirstFrame(directory: string): Promise<CheckResult['replayed']> {
  const tape = await loadTape(directory)
  const frame = tape.frames.find(candidate => candidate.pruned === undefined) ?? tape.frames[0]!
  const replay = await startReplay(tape, { fromFrame: frame.index, toFrame: frame.index + 1 })
  const socket = net.connect(replay.port, '127.0.0.1')
  let received = ''

  socket.on('data', chunk => void (received += chunk.toString('latin1')))
  socket.on('error', () => undefined)
  await once(socket, 'connect')
  socket.write(`<getProperties version="1.7"/>\n<enableBLOB device="${tape.camera}">Also</enableBLOB>\n`)

  const settled = async (what: string, done: () => boolean) => {
    for (let waited = 0; !done(); waited += 5) {
      if (waited > 10_000) throw new ArchiveError(`replay of ${directory}: timed out waiting for ${what}`)
      await sleep(5)
    }
  }

  await settled('the camera definitions', () => received.includes(`<defNumberVector device="${tape.camera}" name="CCD_EXPOSURE"`))
  socket.write(`<newNumberVector device="${tape.camera}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">${exposureSeconds}</oneNumber></newNumberVector>\n`)
  await settled('the frame', () => replay.events().some(event => event.kind === 'delivered' || event.kind === 'pruned'))
  socket.destroy()
  await replay.stop()

  const pruned = frame.pruned !== undefined
  const event = replay.events().find(candidate => candidate.kind === (pruned ? 'pruned' : 'delivered'))

  if (event === undefined) throw new ArchiveError(`replay of ${directory}: frame ${frame.index} was not ${pruned ? 'answered as pruned' : 'delivered'}`)
  if (!pruned && !received.includes('<setBLOBVector')) throw new ArchiveError(`replay of ${directory}: frame ${frame.index} was delivered but no image reached the client`)

  return { index: frame.index, pruned }
}

export async function checkArchive(directory: string): Promise<CheckResult> {
  const report = await verifyRecording(directory)

  if (!report.valid) throw new ArchiveError(`${directory} fails the recording check: ${JSON.stringify(report.problems.slice(0, 3))}`)
  if (report.prunedStillPresent.length > 0) throw new ArchiveError(`${directory} lists pruned frames whose files are still there: ${report.prunedStillPresent.slice(0, 3).join(', ')}`)

  const replayed = report.images > 0 ? await replayFirstFrame(directory) : undefined

  return { images: report.images, prunedImages: report.prunedImages.length, ...(replayed ? { replayed } : {}) }
}
