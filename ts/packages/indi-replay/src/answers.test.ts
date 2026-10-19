import { readFileSync } from 'node:fs'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startReplay, type Replay } from './replay.js'
import { tapeFromStream } from './synthesize.js'
import { loadTape } from './tape.js'

/**
 * A stream cut (`measure/cut-recording.py`) from a recording Cria's own recorder made against indiserver 2.2.5 with the
 * CCD, focuser and telescope simulators, while another client connected the telescope and asked for it. The
 * telescope's driver defines its properties and sets TELESCOPE_MOUNT_TYPE between two of them, twice in the cut. Cria
 * sent its device-wide ask first and its named reads of the CCD's and the focuser's CONNECTION right after, so both
 * copies reach the recorder after a request that asked for something else.
 */
const recorded: { readonly stream: ReadonlyArray<readonly ['in' | 'out', string]> } = JSON.parse(readFileSync(new URL('./recorded-answer.json', import.meta.url), 'utf8'))
const scope = 'Telescope Simulator'

let directory: string
let replay: Replay | undefined
let socket: net.Socket | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'indi-replay-answers-'))
})

afterEach(async () => {
  socket?.destroy()
  await replay?.stop()
  replay = undefined
  socket = undefined
  await rm(directory, { recursive: true, force: true })
})

const tapeOf = (stream: typeof recorded.stream) =>
  tapeFromStream(stream, { devices: [{ id: 'primary', kind: 'camera', indiDevice: 'CCD Simulator' }], sensor: { width: 16, height: 8 }, startAt: Date.UTC(2026, 9, 19) }, join(directory, 'tape')).then(loadTape)

const names = (xml: string) => [...xml.matchAll(/<(def|set)\w+Vector\b[^>]*?\bdevice="([^"]*)"[^>]*?\bname="([^"]*)"/g)].map(match => `${match[1]} ${match[3]}`)

async function ask(request: string): Promise<string[]> {
  replay ??= await startReplay(await tapeOf(recorded.stream))
  socket ??= await new Promise<net.Socket>((resolve, reject) => {
    const connected = net.connect(replay!.port, '127.0.0.1')

    connected.once('connect', () => resolve(connected))
    connected.once('error', reject)
  })
  let text = ''
  const listen = (chunk: Buffer) => void (text += chunk.toString('utf8'))

  socket.on('data', listen)
  socket.write(`${request}<pingRequest uid="done"/>`)
  for (let waited = 0; !text.includes('<pingReply uid="done"/>'); waited += 5) {
    if (waited > 5000) throw new Error(`no ping reply; received ${text.slice(-300)}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  socket.off('data', listen)

  return names(text)
}

describe('what the telescope sets inside its answer, read from a recording Cria made', () => {
  it('is found although the later copies of the answer follow requests that asked for another device', async () => {
    const tape = await tapeOf(recorded.stream)

    expect([...tape.answerSets.keys()]).toEqual([`${scope}.TELESCOPE_MOUNT_TYPE`])
    expect(tape.answerSets.get(`${scope}.TELESCOPE_MOUNT_TYPE`)?.after).toBe('SNOOP_JOYSTICK')
    expect(tape.events.filter(event => event.answer).map(event => (event.kind === 'update' ? event.name : undefined))).toEqual(Array(2).fill('TELESCOPE_MOUNT_TYPE'))
  })

  it('is sent to a client that asks for the whole device, after the definition it followed, and not for one property', async () => {
    const whole = await ask(`<getProperties version="1.7" device="${scope}"/>`)
    const at = whole.indexOf('set TELESCOPE_MOUNT_TYPE')

    expect(at).toBeGreaterThan(whole.indexOf('def TELESCOPE_MOUNT_TYPE'))
    expect(whole[at - 1]).toBe('def SNOOP_JOYSTICK')
    expect(await ask(`<getProperties version="1.7" device="${scope}" name="TELESCOPE_MOUNT_TYPE"/>`)).toEqual(['def TELESCOPE_MOUNT_TYPE'])
  })

  const slot = `${scope}.TELESCOPE_MOUNT_TYPE`
  const withoutFirstAsk = recorded.stream.slice(1)
  const firstBurstOnly = recorded.stream.filter(([dir, xml], at) => dir === 'out' || at < 66 || !xml.includes(`device="${scope}"`))

  it('is found from two answers nobody asked for, since a driver also sets things once when a connection brings its properties', async () => {
    expect([...(await tapeOf(withoutFirstAsk)).answerSets.keys()]).toEqual([slot])
  })

  it('is not found from one answer nobody asked for', async () => {
    expect((await tapeOf(firstBurstOnly.slice(1))).answerSets.size).toBe(0)
  })

  it('is found from the one answer to a request in the recording', async () => {
    expect([...(await tapeOf(firstBurstOnly)).answerSets.keys()]).toEqual([slot])
  })
})
