import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startReplay, type Replay } from './replay.js'
import { tapeFromStream } from './synthesize.js'
import { loadTape } from './tape.js'

/**
 * What an observing client receives from indi-replay against what it received from real indiserver 2.2.5
 * (indi_simulator_ccd and indi_simulator_focus), for the same recording and the same requests.
 * The fixture is measure/measure-definitions.py's output: the recorder's stream becomes the tape, and each
 * scenario lists the definitions, updates and deletions that three observers received after every step.
 */
interface World {
  readonly indiserver: string
  readonly camera: string
  readonly focuser: string
  readonly messages: Readonly<Record<string, string>>
  readonly tape: ReadonlyArray<readonly ['in' | 'out', string]>
  readonly scenarios: ReadonlyArray<{
    readonly title: string
    readonly steps: ReadonlyArray<{ readonly client: string; readonly send: string } | { readonly advance: true }>
    readonly heard: Readonly<Record<string, ReadonlyArray<ReadonlyArray<string>>>>
  }>
}

const world: World = JSON.parse(readFileSync(new URL('./indiserver-definitions.json', import.meta.url), 'utf8'))
const sensor = { width: 1280, height: 1024 }

let directory: string
let replay: Replay | undefined
let sockets: net.Socket[] = []

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'indi-replay-equivalence-'))
})

afterEach(async () => {
  await replay?.stop()
  replay = undefined
  for (const socket of sockets) socket.destroy()
  sockets = []
  await rm(directory, { recursive: true, force: true })
})

class Observer {
  text = ''

  private constructor(readonly socket: net.Socket) {
    socket.on('data', chunk => void (this.text += chunk.toString('utf8')))
    socket.on('error', () => undefined)
  }

  static async connect(port: number): Promise<Observer> {
    const socket = net.connect(port, '127.0.0.1')

    sockets.push(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    return new Observer(socket)
  }

  /** Everything received since the last call, as definitions, updates and deletions. */
  take(): string[] {
    const found = [...this.text.matchAll(/<(def\w+Vector|set\w+Vector|delProperty)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g)].map(match => match[0])

    this.text = ''

    return found
  }

  async ping(uid: string): Promise<void> {
    this.socket.write(`<pingRequest uid="${uid}"/>`)
    for (let waited = 0; !this.text.includes(`<pingReply uid="${uid}"/>`); waited += 5) {
      if (waited > 5000) throw new Error(`no ping reply; received ${this.text.slice(-300)}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
}

const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]))
const number = (text: string | undefined) => (text === undefined ? '' : String(Number(text)))

/** What a client can tell apart: not whitespace, attribute order or timestamps. */
function canonical(xml: string): string {
  const deletion = /^<delProperty\b([^>]*?)\/?>/.exec(xml)

  if (deletion) return `del ${attributes(deletion[1]!).device} ${attributes(deletion[1]!).name ?? ''}`

  const head = /^<(def|set)(\w+)Vector\b([^>]*)>/.exec(xml)!
  const vector = attributes(head[3]!)
  const defined = head[1] === 'def'
  const elements = [...xml.matchAll(/<(?:def|one)(Number|Switch|Text|Light|BLOB)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:def|one)\1>)/g)].map(match => {
    const element = attributes(match[2]!)
    const value = (match[3] ?? '').trim()
    const shown = match[1] === 'Number' ? number(value) : value

    return defined
      ? `${element.name}|${element.label}|${shown}|${match[1] === 'Number' ? `${element.format}|${number(element.min)}|${number(element.max)}|${number(element.step)}` : ''}`
      : `${element.name}|${shown}|${match[1] === 'Number' ? `${number(element.min)}|${number(element.max)}|${number(element.step)}` : ''}`
  })

  return defined
    ? `def ${vector.device}/${vector.name} ${head[2]} ${vector.state} ${vector.perm} ${vector.rule ?? ''} ${vector.label} ${vector.group} ${vector.timeout} [${elements.join(', ')}]`
    : `set ${vector.device}/${vector.name} ${head[2]} ${vector.state} [${elements.join(', ')}]`
}

const device = (canonicalMessage: string) => /^\w+ ([^/]+)\//.exec(canonicalMessage)?.[1]

/**
 * The first time each distinct message appears, in order, per device: the order a client sees properties in.
 * Two drivers are two processes writing to indiserver at once, so how their messages interleave is not repeatable;
 * the copies a driver repeats come after its first pass, in an order that carries no information (they are identical).
 */
const firstOccurrences = (messages: ReadonlyArray<string>, of: string | undefined) => [...new Set(messages.filter(message => device(message) === of))]

describe('what observers receive from the replay matches real indiserver', () => {
  it.each(world.scenarios.map(scenario => [scenario.title, scenario] as const))('%s', async (_title, scenario) => {
    const folder = join(directory, 'tape')

    await tapeFromStream(
      world.tape.map(([dir, entry]) => [dir, dir === 'in' ? world.messages[entry]! : entry] as const),
      { devices: [{ id: 'primary', kind: 'camera', indiDevice: world.camera }, { id: 'focuser', kind: 'focuser', indiDevice: world.focuser }], sensor, startAt: Date.UTC(2026, 9, 19) },
      folder,
    )
    replay = await startReplay(await loadTape(folder))

    const observers = Object.fromEntries(await Promise.all(['a', 'b', 'c'].map(async name => [name, await Observer.connect(replay!.port)] as const)))
    const control = await Observer.connect(replay.port)
    const names = Object.keys(observers)
    const wrong: string[] = []

    for (const [index, step] of scenario.steps.entries()) {
      if ('advance' in step) {
        for (const expected of [1, 2]) {
          control.socket.write(`<newNumberVector device="${world.camera}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">0.05</oneNumber></newNumberVector>`)
          for (let waited = 0; replay.events().filter(event => event.kind === 'delivered').length < expected; waited += 5) {
            if (waited > 5000) throw new Error('the exposure was not delivered')
            await new Promise(resolve => setTimeout(resolve, 5))
          }
        }
      } else {
        observers[step.client]!.socket.write(step.send)
      }

      for (const name of names) await observers[name]!.ping(`step-${index}`)

      for (const name of names) {
        const advanced = 'advance' in step
        // An exposure's own traffic is the exposure machine's, not a definition; the focuser's limits are the tape's.
        const only = (messages: ReadonlyArray<string>) => (advanced ? messages.filter(message => device(message) === world.focuser) : messages)
        const expected = only(scenario.heard[name]![index]!.map(id => canonical(world.messages[id]!)))
        const got = only(observers[name]!.take().map(canonical))

        if (JSON.stringify([...expected].sort()) !== JSON.stringify([...got].sort())) {
          const missing = expected.filter(message => !got.includes(message))
          const extra = got.filter(message => !expected.includes(message))

          const counted = [...new Set([...expected, ...got])].filter(message => expected.filter(x => x === message).length !== got.filter(x => x === message).length)

          wrong.push(`step ${index} client ${name}: indiserver sent ${expected.length}, replay sent ${got.length}; only indiserver sent ${JSON.stringify(missing.slice(0, 2))}; only replay sent ${JSON.stringify(extra.slice(0, 2))}; different number of copies of ${JSON.stringify(counted.slice(0, 2))}`)
        } else if ([world.camera, world.focuser].some(of => JSON.stringify(firstOccurrences(expected, of)) !== JSON.stringify(firstOccurrences(got, of)))) {
          wrong.push(`step ${index} client ${name}: same messages, different order of properties`)
        }
      }
    }

    expect(wrong).toEqual([])
  })
})

const cam = 'Test Camera'
const small = { width: 16, height: 8 }
const numberVector = (verb: 'def' | 'set', name: string, state: string, elements: ReadonlyArray<string>) =>
  `<${verb}NumberVector device="${cam}" name="${name}" state="${state}"${verb === 'def' ? ' label="" group="Main" perm="rw" timeout="60"' : ''}>${elements.join('')}</${verb}NumberVector>`
const defNumber = (name: string, value: number, limits: string) => `<defNumber name="${name}" label="${name}" format="${/format="([^"]*)"/.exec(limits)?.[1] ?? '%g'}" ${limits.replace(/format="[^"]*"/, '')}>${value}</defNumber>`
const oneNumber = (name: string, value: number, limits = '') => `<oneNumber name="${name}"${limits}>${value}</oneNumber>`
const exposure = (state: string, value: number) => numberVector('set', 'CCD_EXPOSURE', state, [oneNumber('CCD_EXPOSURE_VALUE', value)])
const image = `<setBLOBVector device="${cam}" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="1" format=".fits"/></setBLOBVector>`

/** A camera that is set to the sensor's size and takes two exposures; `between` is what the driver says between them. */
function session(between: ReadonlyArray<string>): ReadonlyArray<readonly ['in' | 'out', string]> {
  return [
    ['out', '<getProperties version="1.7"/>'],
    ['in', `<defSwitchVector device="${cam}" name="CONNECTION" label="" group="Main" state="Ok" perm="rw" rule="OneOfMany" timeout="60"><defSwitch name="CONNECT" label="Connect">On</defSwitch><defSwitch name="DISCONNECT" label="Disconnect">Off</defSwitch></defSwitchVector>`],
    ['in', numberVector('def', 'CCD_FRAME', 'Ok', [defNumber('WIDTH', small.width, 'min="0" max="0" step="0"'), defNumber('HEIGHT', small.height, 'min="0" max="0" step="0"')])],
    ['in', numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'min="1" max="4" step="1"'), defNumber('VER_BIN', 1, 'min="1" max="4" step="1"')])],
    ['in', numberVector('def', 'CCD_GAIN', 'Ok', [defNumber('GAIN', 10, 'min="0" max="100" step="1"')])],
    ['in', numberVector('def', 'CCD_EXPOSURE', 'Idle', [defNumber('CCD_EXPOSURE_VALUE', 0, 'min="0" max="3600" step="1"')])],
    ['in', `<defBLOBVector device="${cam}" name="CCD1" label="" group="Main" state="Idle" perm="ro" timeout="60"><defBLOB name="CCD1" label="Image"/></defBLOBVector>`],
    ['in', exposure('Busy', 0.05)],
    ['in', image],
    ['in', exposure('Ok', 0)],
    ...between.map(xml => ['in', xml] as const),
    ['in', exposure('Busy', 0.05)],
    ['in', image],
    ['in', exposure('Ok', 0)],
  ]
}

async function observe(between: ReadonlyArray<string>) {
  const folder = join(directory, 'stream')

  await tapeFromStream(session(between), { devices: [{ id: 'primary', kind: 'camera', indiDevice: cam }], sensor: small, startAt: Date.UTC(2026, 9, 19) }, folder)
  replay = await startReplay(await loadTape(folder))
  const [watching, writer] = [await Observer.connect(replay.port), await Observer.connect(replay.port)]

  watching.socket.write(`<getProperties version="1.7" device="${cam}"/>`)
  await watching.ping('start')
  watching.take()

  const advance = async (count: number) => {
    writer.socket.write(`<newNumberVector device="${cam}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">0.05</oneNumber></newNumberVector>`)
    for (let waited = 0; replay!.events().filter(event => event.kind === 'delivered').length < count; waited += 5) {
      if (waited > 5000) throw new Error('the exposure was not delivered')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    await watching.ping(`advance-${count}`)

    return watching.take().filter(message => !message.includes('name="CCD_EXPOSURE"'))
  }

  return { watching, writer, advance }
}

describe('limits and definitions a driver changes between frames', () => {
  it('a recorded set that changes min, max and step reaches the clients watching, and the definition they ask for afterwards', async () => {
    const { watching, advance } = await observe([numberVector('set', 'CCD_FRAME', 'Ok', [oneNumber('WIDTH', 16, ' min="1" max="16" step="2"'), oneNumber('HEIGHT', 8, ' min="1" max="8"')])])

    await advance(1)
    const relayed = await advance(2)

    expect(relayed).toHaveLength(1)
    expect(canonical(relayed[0]!)).toBe('set Test Camera/CCD_FRAME Number Ok [WIDTH|16|1|16|2, HEIGHT|8|1|8|]')

    watching.socket.write(`<getProperties version="1.7" device="${cam}" name="CCD_FRAME"/>`)
    await watching.ping('asked')

    expect(canonical(watching.take()[0]!)).toBe('def Test Camera/CCD_FRAME Number Ok rw   Main 60 [WIDTH|WIDTH|16|%g|1|16|2, HEIGHT|HEIGHT|8|%g|1|8|0]')
  })

  it('a limit changes under a value a client wrote, which the client keeps', async () => {
    const { watching, writer, advance } = await observe([numberVector('set', 'CCD_GAIN', 'Ok', [oneNumber('GAIN', 10, ' max="200"')])])

    writer.socket.write(`<newNumberVector device="${cam}" name="CCD_GAIN"><oneNumber name="GAIN">20</oneNumber></newNumberVector>`)
    await watching.ping('written')
    watching.take()
    await advance(1)
    const relayed = await advance(2)

    expect(relayed.map(canonical)).toEqual(['set Test Camera/CCD_GAIN Number Ok [GAIN|20||200|]'])
  })

  it('a property the driver defines again with other limits and format is defined again to the clients watching', async () => {
    const { advance } = await observe([numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'format="%.0f" min="1" max="8" step="1"'), defNumber('VER_BIN', 1, 'format="%.0f" min="1" max="8" step="1"')])])

    await advance(1)
    const relayed = await advance(2)

    expect(relayed.map(canonical)).toEqual(['def Test Camera/CCD_BINNING Number Ok rw   Main 60 [HOR_BIN|HOR_BIN|1|%.0f|1|8|1, VER_BIN|VER_BIN|1|%.0f|1|8|1]'])
  })

  it('a definition identical to the one before is not sent again', async () => {
    const same = numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'min="1" max="4" step="1"'), defNumber('VER_BIN', 1, 'min="1" max="4" step="1"')])
    const { advance } = await observe([same])

    await advance(1)

    expect(await advance(2)).toEqual([])
  })
})
