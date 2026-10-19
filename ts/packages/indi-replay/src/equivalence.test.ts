import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Option, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeIndiClient, type DeviceEvent, type Property } from '@cria/indi'
import { startReplay, type Replay } from './replay.js'
import { tapeFromStream } from './synthesize.js'
import { loadTape } from './tape.js'

/**
 * What an observing client receives from indi-replay against what it received from real indiserver 2.2.5
 * (indi_simulator_ccd, _focus, _telescope and _weather), for the same recording and the same requests.
 * The fixture is measure/measure-definitions.py's output: the recorder's stream becomes the tape, and each
 * scenario lists everything three observers received after every step: definitions, updates, deletions and
 * the drivers' standalone messages.
 *
 * Two comparisons, so that no field is compared by a choice made here:
 *
 * - Every attribute and every value of every element must be the same, whatever Cria reads of them. What is
 *   left out is named, with the reason: attributes in `notCompared`, elements in `comparable`.
 * - The same elements are fed to Cria's own client (`makeIndiClient`), from a server that does nothing but
 *   play them, and what Cria sees must be the same: every event it publishes and every property in its
 *   mirror, with each field it decodes. That is what shows the way the first comparison reads numbers and
 *   whitespace cannot change what Cria sees.
 */
interface World {
  readonly indiserver: string
  readonly camera: string
  readonly focuser: string
  readonly volatile: ReadonlyArray<string>
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
const devices = ['CCD Simulator', 'Focuser Simulator', 'Telescope Simulator', 'Weather Simulator']

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

  /** Everything received since the last call, as definitions, updates, deletions and messages. */
  take(): string[] {
    const found = [...this.text.matchAll(/<(def\w+Vector|set\w+Vector|delProperty|message)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g)].map(match => match[0])

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

const decimal = (text: string) => (text.trim() !== '' && Number.isFinite(Number(text)) ? String(Number(text)) : text)

/**
 * The attributes not compared. `timestamp` is the time indiserver stamped on an element: Cria's parser does not
 * decode it, and a replay that stamped the recording's time would tell a client it is a different night.
 *
 * A number's text, `min`, `max` and `step` are compared as numbers, because the replay holds numbers as numbers
 * (`4.29497e+09` is sent as `4294970000`). Cria decodes them with `parseNumber`, which reads both the same, and
 * the second comparison feeds both to Cria to show it.
 */
const notCompared = ['timestamp'] as const

/** What a client can tell apart, every attribute included: not whitespace, attribute order, the time indiserver stamps or how a number is written. */
function canonical(xml: string): string {
  return xml
    .replace(/<(\w+)([^>]*?)(\/?)>/g, (_, tag: string, rest: string, close: string) => {
      const found = Object.entries(attributes(rest))
        .filter(([name]) => !(notCompared as ReadonlyArray<string>).includes(name))
        .map(([name, value]) => [name, ['min', 'max', 'step'].includes(name) ? decimal(value) : value] as const)

      return `<${tag}${found.sort(([x], [y]) => x.localeCompare(y)).map(([name, value]) => ` ${name}=${JSON.stringify(value)}`).join('')}${close}>`
    })
    .replace(/<(\w+)([^>]*?)\/>/g, '<$1$2></$1>')
    .replace(/(<(?:def|one)Number\b[^>]*>)([^<]*)/g, (_, tag: string, text: string) => `${tag}${decimal(text.trim())}`)
    .replace(/\s+/g, ' ')
    .replace(/> /g, '>')
    .replace(/ </g, '<')
    .trim()
}

const identity = (xml: string) => {
  const { device, name } = attributes(/^<[^>]*>/.exec(xml)![0])

  return { device, name, set: xml.startsWith('<set') }
}

const device = (xml: string) => identity(xml).device

/**
 * The first time each distinct message appears, in order, per device: the order a client sees properties in.
 * Two drivers are two processes writing to indiserver at once, so how their messages interleave is not repeatable;
 * the copies a driver repeats come after its first pass, in an order that carries no information (they are identical).
 */
const firstOccurrences = (messages: ReadonlyArray<string>, of: string | undefined) => [...new Set(messages.filter(message => device(message) === of))]

/**
 * The elements not compared, and why. Both sides are filtered the same way.
 * - `world.volatile` are properties that change on their own or with the time of day the run began: the
 *   telescope reports its position every fraction of a second, the weather station updates every minute, the
 *   clock and the axes follow the time of day. How many updates a client gets depends on how long the real run
 *   took, and a value on the day it was made is not today's. The replay follows the recording's frames. Their
 *   definitions are compared, with the value the property has at the moment left out; the updates are not.
 * - After a client writes, a driver may say things about its own work that a replay cannot know: the focuser saves its
 *   configuration and says so in two standalone `<message>`s. They are left out of the steps where a client writes;
 *   Cria discards them (`xml.ts`), and the properties the write changes are compared, attribute by attribute.
 * - While exposures are taken, the camera's exposure and abort properties are the replay's exposure machine's:
 *   it answers the client's own exposure, not the recorded one.
 * - An image is compared without its bytes, `size` and `len` (they must be there, with any number): the
 *   tape's frames are made up (the test cannot keep a simulator's image), and Cria does not use them; what
 *   the bytes are is `testing/replay.test.ts`'s.
 */
function comparable(messages: ReadonlyArray<string>, advanced: boolean, wrote: boolean): string[] {
  return messages.map(withoutBytes).map(blankIfMoving).filter(xml => {
    if (wrote && xml.startsWith('<message')) return false

    const { device: of, name, set } = identity(xml)

    if (set && world.volatile.includes(`${of}/${name}`)) return false

    return !(advanced && of === world.camera && ['CCD_EXPOSURE', 'CCD_ABORT_EXPOSURE'].includes(name ?? ''))
  })
}

function withoutBytes(xml: string): string {
  return xml.startsWith('<setBLOBVector') ? xml.replace(/<oneBLOB\b([^>]*?)(?:\/>|>[^<]*<\/oneBLOB>)/g, (_, attributes: string) => `<oneBLOB${attributes.replace(/\b(size|len)="\d+"/g, '$1="0"')}/>`) : xml
}

/** A volatile property is defined with the value it has at that moment, which depends on when: its shape is compared, its value is not (numbers are set to 0 and texts to x on both sides). */
function blankIfMoving(xml: string): string {
  const { device: of, name, set } = identity(xml)

  return !set && xml.startsWith('<def') && world.volatile.includes(`${of}/${name}`)
    ? xml.replace(/(<defNumber\b[^>]*>)[^<]*/g, (_, tag: string) => `${tag}0`).replace(/(<defText\b[^>]*>)[^<]*/g, (_, tag: string) => `${tag}x`)
    : xml
}

/**
 * A replay starts from the state when the first exposure's Busy was said, so the driver's standalone messages
 * just before it, which belong to starting that exposure, are history to it. Real indiserver sends them to
 * whoever is connected. Cria discards every standalone `<message>` (`xml.ts`, the default of `toMessage`), so
 * this changes nothing it sees; the later exposures replay theirs.
 */
function withoutOpeningWords(expected: ReadonlyArray<string>): string[] {
  const busy = expected.findIndex(xml => xml.includes(`device="${world.camera}"`) && xml.includes('name="CCD_EXPOSURE"') && xml.includes('state="Busy"'))

  return expected.filter((xml, index) => !(xml.startsWith('<message') && xml.includes(`device="${world.camera}"`) && index < busy))
}

/** Where two renderings of one element first differ, with some text around it. */
function whereDiffers(wanted: string, heard: string): string {
  let at = 0

  while (at < wanted.length && wanted[at] === heard[at]) at += 1

  return `...${wanted.slice(Math.max(0, at - 60), at + 80)} <> ${heard.slice(Math.max(0, at - 60), at + 80)}`
}

function differences(expected: ReadonlyArray<string>, got: ReadonlyArray<string>): string | undefined {
  const [wanted, heard] = [expected.map(canonical), got.map(canonical)]

  if (JSON.stringify([...wanted].sort()) !== JSON.stringify([...heard].sort())) {
    const missing = wanted.filter(message => !heard.includes(message))
    const extra = heard.filter(message => !wanted.includes(message))
    const counted = [...new Set([...wanted, ...heard])].filter(message => wanted.filter(x => x === message).length !== heard.filter(x => x === message).length)
    const brief = (list: ReadonlyArray<string>) => JSON.stringify(list.slice(0, 3).map(xml => (xml.length > 200 ? `${xml.slice(0, 200)}...` : xml)))
    const kind = (xml: string) => `${/^<(\w+)/.exec(xml)![1]} ${/device="([^"]*)"/.exec(xml)?.[1]} ${/name="([^"]*)"/.exec(xml)?.[1]}`
    const changed = missing.flatMap(xml => {
      const other = extra.find(candidate => kind(candidate) === kind(xml))

      return other === undefined ? [] : [`${kind(xml)} ${whereDiffers(xml, other)}`]
    })

    return `indiserver sent ${wanted.length}, replay sent ${heard.length}; same element, different text (indiserver <> replay): ${JSON.stringify(changed.slice(0, 6))}; only indiserver sent ${brief(missing)}; only replay sent ${brief(extra)}; different number of copies of ${JSON.stringify(counted.slice(0, 6).map(xml => `${kind(xml)} indiserver ${wanted.filter(x => x === xml).length}, replay ${heard.filter(x => x === xml).length}`))}`
  }

  if ([world.camera, world.focuser].some(of => JSON.stringify(firstOccurrences(wanted, of)) !== JSON.stringify(firstOccurrences(heard, of)))) return 'same messages, different order of properties'

  return undefined
}

/** A server that plays `raw` to whoever connects, once released, then says nothing. */
async function playback(raw: string) {
  const open: net.Socket[] = []
  const server = net.createServer(socket => {
    open.push(socket)
    socket.on('error', () => undefined)
    socket.write(raw)
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  return { port: (server.address() as net.AddressInfo).port, stop: () => new Promise<void>(resolve => (open.forEach(socket => socket.destroy()), server.close(() => resolve()))) }
}

const sentinel = '<defTextVector device="Sentinel" name="END" label="END" group="Main" state="Ok" perm="ro" timeout="0"><defText name="END" label="END">end</defText></defTextVector>'

/** Everything Cria's own client sees of `raw`: each event it publishes per device, and its mirror in the end. */
async function criaSees(raw: ReadonlyArray<string>) {
  const served = await playback(`${raw.join('\n')}\n${sentinel}\n`)

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeIndiClient({ host: '127.0.0.1', port: served.port })
          const events: string[] = []

          for (const name of devices)
            yield* Effect.forkScoped(
              Stream.runForEach(client.device(name).events, event =>
                Effect.sync(() => {
                  if (event.type !== 'connection') events.push(JSON.stringify([name, summary(event)]))
                }),
              ),
            )

          for (let waited = 0; Option.isNone(yield* client.device('Sentinel').property('END')); waited += 10) {
            if (waited > 10_000) throw new Error('Cria did not reach the end of the stream')
            yield* Effect.sleep('10 millis')
          }

          const mirror: Record<string, unknown> = {}

          for (const name of devices) mirror[name] = (yield* client.device(name).properties).map(summaryOfProperty).sort((x, y) => x.name.localeCompare(y.name))

          return { events: events.sort(), mirror }
        }),
      ),
    )
  } finally {
    await served.stop()
  }
}

function summaryOfProperty(property: Property) {
  const { receivedAt: _, elements, ...rest } = property

  return { ...rest, elements: [...elements.entries()] }
}

function summary(event: DeviceEvent) {
  if (event.type === 'property') return { type: event.type, origin: event.origin, property: summaryOfProperty(event.property) }

  return event.type === 'blob' ? { type: event.type, blob: { ...event.blob, data: event.blob.data.length, receivedAt: 0 } } : event
}

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
    const [expectedAll, gotAll] = [Object.fromEntries(names.map(name => [name, [] as string[]])), Object.fromEntries(names.map(name => [name, [] as string[]]))]

    for (const [index, step] of scenario.steps.entries()) {
      const advanced = 'advance' in step
      const wrote = !advanced && step.send.startsWith('<new')

      if (advanced) {
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
        const heard = scenario.heard[name]![index]!.map(id => world.messages[id]!)
        const expected = comparable(advanced && index === scenario.steps.findIndex(other => 'advance' in other) ? withoutOpeningWords(heard) : heard, advanced, wrote)
        const got = comparable(observers[name]!.take(), advanced, wrote)
        const problem = differences(expected, got)

        expectedAll[name]!.push(...expected)
        gotAll[name]!.push(...got)
        if (problem) wrong.push(`step ${index} client ${name}: ${problem}`)
      }
    }

    expect(wrong).toEqual([])

    for (const name of names) {
      const [real, replayed] = await Promise.all([criaSees(expectedAll[name]!), criaSees(gotAll[name]!)])

      expect({ client: name, events: replayed.events, mirror: replayed.mirror }).toEqual({ client: name, events: real.events, mirror: real.mirror })
    }
  }, 60_000)
})

describe('a driver\'s rejection reaches Cria with its reason', () => {
  it('Cria\'s client sees the Alert on FOCUS_MAX with the words the driver gave, as it does from the simulator', async () => {
    const folder = join(directory, 'tape')

    await tapeFromStream(
      world.tape.map(([dir, entry]) => [dir, dir === 'in' ? world.messages[entry]! : entry] as const),
      { devices: [{ id: 'primary', kind: 'camera', indiDevice: world.camera }, { id: 'focuser', kind: 'focuser', indiDevice: world.focuser }], sensor, startAt: Date.UTC(2026, 9, 19) },
      folder,
    )
    replay = await startReplay(await loadTape(folder))
    const control = await Observer.connect(replay.port)
    const port = replay.port

    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeIndiClient({ host: '127.0.0.1', port })
          const events: string[] = []

          yield* Effect.forkScoped(
            Stream.runForEach(client.device(world.focuser).events, event =>
              Effect.sync(() => {
                if (event.type !== 'property' || event.property.name !== 'FOCUS_MAX') return
                const limit = event.property.elements.get('FOCUS_MAX_VALUE')

                events.push(`${event.origin} ${event.property.state} ${event.property.message ?? '-'} ${limit?.kind === 'number' ? limit.value : '-'}`)
              }),
            ),
          )

          for (let waited = 0; Option.isNone(yield* client.device(world.focuser).property('FOCUS_MAX')); waited += 10) {
            if (waited > 10_000) throw new Error('Cria was not told of FOCUS_MAX')
            yield* Effect.sleep('10 millis')
          }

          for (const expected of [1, 2]) {
            control.socket.write(`<newNumberVector device="${world.camera}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">0.05</oneNumber></newNumberVector>`)
            for (let waited = 0; replay!.events().filter(event => event.kind === 'delivered').length < expected; waited += 10) {
              if (waited > 10_000) throw new Error('the exposure was not delivered')
              yield* Effect.sleep('10 millis')
            }
          }
          yield* Effect.sleep('100 millis')

          return events
        }),
      ),
    )

    expect(seen).toContain('set Alert Error: Invalid range for Steps (FOCUS_MAX_VALUE). Valid range is from 1000 to 1e+06. Requested value is -1 100000')
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
function session(between: ReadonlyArray<string>, secondImage = image): ReadonlyArray<readonly ['in' | 'out', string]> {
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
    ['in', secondImage],
    ['in', exposure('Ok', 0)],
  ]
}

const observe = (between: ReadonlyArray<string>, secondImage = image) => watch(session(between, secondImage))

async function watch(stream: ReadonlyArray<readonly ['in' | 'out', string]>) {
  const folder = join(directory, 'stream')

  await tapeFromStream(stream, { devices: [{ id: 'primary', kind: 'camera', indiDevice: cam }], sensor: small, startAt: Date.UTC(2026, 9, 19) }, folder)
  replay = await startReplay(await loadTape(folder))
  const [watching, writer] = [await Observer.connect(replay.port), await Observer.connect(replay.port)]

  watching.socket.write(`<getProperties version="1.7" device="${cam}"/>`)
  await watching.ping('start')
  const started = watching.take()

  const advance = async (count: number) => {
    writer.socket.write(`<newNumberVector device="${cam}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">0.05</oneNumber></newNumberVector>`)
    for (let waited = 0; replay!.events().filter(event => event.kind === 'delivered').length < count; waited += 5) {
      if (waited > 5000) throw new Error('the exposure was not delivered')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    await watching.ping(`advance-${count}`)

    return watching.take().filter(message => !message.includes('name="CCD_EXPOSURE"'))
  }

  return { watching, writer, advance, started }
}

describe('limits and definitions a driver changes between frames', () => {
  it('a recorded set that changes min, max and step reaches the clients watching, and the definition they ask for afterwards', async () => {
    const { watching, advance } = await observe([numberVector('set', 'CCD_FRAME', 'Ok', [oneNumber('WIDTH', 16, ' min="1" max="16" step="2"'), oneNumber('HEIGHT', 8, ' min="1" max="8"')])])

    await advance(1)
    const relayed = await advance(2)

    expect(relayed).toHaveLength(1)
    expect(canonical(relayed[0]!)).toBe(
      '<setNumberVector device="Test Camera" name="CCD_FRAME" state="Ok"><oneNumber max="16" min="1" name="WIDTH" step="2">16</oneNumber><oneNumber max="8" min="1" name="HEIGHT">8</oneNumber></setNumberVector>',
    )

    watching.socket.write(`<getProperties version="1.7" device="${cam}" name="CCD_FRAME"/>`)
    await watching.ping('asked')

    expect(canonical(watching.take()[0]!)).toBe(
      '<defNumberVector device="Test Camera" group="Main" label="" name="CCD_FRAME" perm="rw" state="Ok" timeout="60">' +
        '<defNumber format="%g" label="WIDTH" max="16" min="1" name="WIDTH" step="2">16</defNumber><defNumber format="%g" label="HEIGHT" max="8" min="1" name="HEIGHT" step="0">8</defNumber></defNumberVector>',
    )
  })

  it('a limit changes under a value a client wrote, which the client keeps', async () => {
    const { watching, writer, advance } = await observe([numberVector('set', 'CCD_GAIN', 'Ok', [oneNumber('GAIN', 10, ' max="200"')])])

    writer.socket.write(`<newNumberVector device="${cam}" name="CCD_GAIN"><oneNumber name="GAIN">20</oneNumber></newNumberVector>`)
    await watching.ping('written')
    watching.take()
    await advance(1)
    const relayed = await advance(2)

    expect(relayed.map(canonical)).toEqual(['<setNumberVector device="Test Camera" name="CCD_GAIN" state="Ok"><oneNumber max="200" name="GAIN">20</oneNumber></setNumberVector>'])
  })

  it('a property the driver defines again with other limits and format is defined again to the clients watching', async () => {
    const { advance } = await observe([numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'format="%.0f" min="1" max="8" step="1"'), defNumber('VER_BIN', 1, 'format="%.0f" min="1" max="8" step="1"')])])

    await advance(1)
    const relayed = await advance(2)

    expect(relayed.map(canonical)).toEqual([
      '<defNumberVector device="Test Camera" group="Main" label="" name="CCD_BINNING" perm="rw" state="Ok" timeout="60">' +
        '<defNumber format="%.0f" label="HOR_BIN" max="8" min="1" name="HOR_BIN" step="1">1</defNumber><defNumber format="%.0f" label="VER_BIN" max="8" min="1" name="VER_BIN" step="1">1</defNumber></defNumberVector>',
    ])
  })

  it('a definition identical to the one before is not sent again', async () => {
    const same = numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'min="1" max="4" step="1"'), defNumber('VER_BIN', 1, 'min="1" max="4" step="1"')])
    const { advance } = await observe([same])

    await advance(1)

    expect(await advance(2)).toEqual([])
  })
})

describe('what a driver says in words between frames', () => {
  const gain = (state: string, message?: string) => `<setNumberVector device="${cam}" name="CCD_GAIN" state="${state}"${message === undefined ? '' : ` message="${message}"`}><oneNumber name="GAIN">10</oneNumber></setNumberVector>`

  it('a standalone message reaches the clients watching its device, and one without a device reaches everyone', async () => {
    const { watching, writer, advance } = await observe([`<message device="${cam}" message="exposure started &amp; going"/>`, '<message message="to everyone"/>', '<message device="Other" message="not here"/>'])

    await advance(1)
    const relayed = await advance(2)

    expect(relayed.map(canonical)).toEqual([`<message device="${cam}" message="exposure started &amp; going"></message>`, '<message message="to everyone"></message>'])
    expect(writer.take().map(canonical)).toEqual(['<message message="to everyone"></message>'])
    expect(watching.take()).toEqual([])
  })

  it('a message on an update, a definition and a deletion is relayed with them', async () => {
    const { advance } = await observe([
      gain('Alert', 'Error: Invalid range for value (GAIN). Valid range is from 0 to 300. Requested value is -5'),
      numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'min="1" max="8" step="1"'), defNumber('VER_BIN', 1, 'min="1" max="8" step="1"')]).replace('timeout="60"', 'timeout="60" message="binning changed"'),
      `<delProperty device="${cam}" name="CCD_BINNING" message="binning gone"/>`,
    ])

    await advance(1)
    const relayed = (await advance(2)).map(canonical)

    expect(relayed[0]).toBe(
      `<setNumberVector device="${cam}" message="Error: Invalid range for value (GAIN). Valid range is from 0 to 300. Requested value is -5" name="CCD_GAIN" state="Alert"><oneNumber name="GAIN">10</oneNumber></setNumberVector>`,
    )
    expect(relayed[1]).toContain('message="binning changed"')
    expect(relayed[2]).toBe(`<delProperty device="${cam}" message="binning gone" name="CCD_BINNING"></delProperty>`)
  })

  it('a message on an update of a property a client wrote goes with the update, which the client\'s value outranks', async () => {
    const { watching, writer, advance } = await observe([gain('Alert', 'driver says no')])

    writer.socket.write(`<newNumberVector device="${cam}" name="CCD_GAIN"><oneNumber name="GAIN">20</oneNumber></newNumberVector>`)
    await watching.ping('written')
    watching.take()
    await advance(1)

    expect(await advance(2)).toEqual([])
  })

  it('a message on a first definition and on a definition identical to the one held is relayed with it each time', async () => {
    const binning = numberVector('def', 'CCD_BINNING', 'Ok', [defNumber('HOR_BIN', 1, 'min="1" max="4" step="1"'), defNumber('VER_BIN', 1, 'min="1" max="4" step="1"')])
    const fresh = numberVector('def', 'CCD_NEW', 'Ok', [defNumber('NEW', 1, 'min="0" max="1" step="1"')])
    const { advance } = await observe([fresh.replace('timeout="60"', 'timeout="60" message="a new property"'), binning.replace('timeout="60"', 'timeout="60" message="binning again"')])

    await advance(1)
    const relayed = (await advance(2)).map(canonical)

    expect(relayed).toHaveLength(2)
    expect(relayed[0]).toContain('name="CCD_NEW"')
    expect(relayed[0]).toContain('message="a new property"')
    expect(relayed[1]).toContain('name="CCD_BINNING"')
    expect(relayed[1]).toContain('message="binning again"')
  })

  it('a message on the deletion of a whole device reaches the clients watching it', async () => {
    const { writer, advance } = await observe(['<delProperty device="Other" message="the driver went away"/>'])

    writer.socket.write('<getProperties version="1.7" device="Other"/>')
    await writer.ping('asked')
    writer.take()
    await advance(1)
    await advance(2)

    expect(writer.take().map(canonical)).toEqual(['<delProperty device="Other" message="the driver went away"></delProperty>'])
  })

  it('a message and a timeout on an image are relayed with it', async () => {
    const withWords = `<setBLOBVector device="${cam}" name="CCD1" state="Ok" timeout="60" message="the sensor is warm"><oneBLOB name="CCD1" size="1" format=".fits"/></setBLOBVector>`
    const { watching, advance } = await observe([], withWords)

    watching.socket.write(`<enableBLOB device="${cam}">Also</enableBLOB>`)
    await watching.ping('enabled')
    await advance(1)
    const relayed = (await advance(2)).map(canonical)

    expect(relayed).toHaveLength(1)
    expect(relayed[0]).toMatch(/^<setBLOBVector device="Test Camera" message="the sensor is warm" name="CCD1" state="Ok" timeout="60"><oneBLOB format="\.fits" len="\d+" name="CCD1" size="\d+">/)
  })
})

describe('what a driver sets inside its answer to a getProperties', () => {
  const connection = (state: string, connect: boolean, message = '') =>
    `<setSwitchVector device="${cam}" name="CONNECTION" state="${state}" timeout="60"${message}><oneSwitch name="CONNECT">${connect ? 'On' : 'Off'}</oneSwitch><oneSwitch name="DISCONNECT">${connect ? 'Off' : 'On'}</oneSwitch></setSwitchVector>`
  const ask = `<getProperties version="1.7" device="${cam}"/>`
  type Stream = ReadonlyArray<readonly ['in' | 'out', string]>
  const defined = (stream: Stream, name: string) => stream.findIndex(([dir, xml]) => dir === 'in' && xml.startsWith('<def') && xml.includes(`name="${name}"`))
  const summary = (xml: ReadonlyArray<string>) => xml.map(text => /^<(\w+)\b.*?\bname="([^"]*)"/s.exec(text)!.slice(1).join(' '))
  const insert = (stream: Stream, at: number, ...entries: Stream): Stream => [...stream.slice(0, at), ...entries, ...stream.slice(at)]

  /** The recorded session with `extra` said by the driver right after the definition of `name`. */
  const after = (name: string, extra: string, stream: Stream = session([])) => insert(stream, defined(stream, name) + 1, ['in', extra])

  it('is sent where the driver sent it, after the definition it followed, to every client that asked for the device', async () => {
    const { watching, writer, started } = await watch(after('CCD_BINNING', connection('Ok', true)))

    expect(summary(started).slice(0, 5)).toEqual(['defSwitchVector CONNECTION', 'defNumberVector CCD_FRAME', 'defNumberVector CCD_BINNING', 'setSwitchVector CONNECTION', 'defNumberVector CCD_GAIN'])
    expect(canonical(started[3]!)).toBe(canonical(connection('Ok', true)))

    writer.socket.write(`<newSwitchVector device="${cam}" name="CONNECTION"><oneSwitch name="CONNECT">Off</oneSwitch><oneSwitch name="DISCONNECT">On</oneSwitch></newSwitchVector>`)
    await watching.ping('written')
    watching.take()
    watching.socket.write(ask)
    await watching.ping('asked')

    const again = watching.take()

    expect(summary(again).slice(0, 5)).toEqual(['defSwitchVector CONNECTION', 'defNumberVector CCD_FRAME', 'defNumberVector CCD_BINNING', 'setSwitchVector CONNECTION', 'defNumberVector CCD_GAIN'])
    expect(canonical(again[3]!)).toBe(canonical(connection('Ok', false)))
  })

  it('is sent right after its own definition when that is where the driver sent it', async () => {
    const { started } = await watch(after('CONNECTION', connection('Ok', true)))

    expect(summary(started).slice(0, 3)).toEqual(['defSwitchVector CONNECTION', 'setSwitchVector CONNECTION', 'defNumberVector CCD_FRAME'])
  })

  it('is not sent in answer to an ask that names a property, as a driver does not', async () => {
    const { watching } = await watch(after('CCD_BINNING', connection('Ok', true)))

    for (const [name, kind] of [['CONNECTION', 'defSwitchVector'], ['CCD_BINNING', 'defNumberVector']] as const) {
      watching.socket.write(`<getProperties version="1.7" device="${cam}" name="${name}"/>`)
      await watching.ping(name)

      expect(summary(watching.take())).toEqual([`${kind} ${name}`])
    }
  })

  it('is not sent again when the recording reaches it, which nobody asked for', async () => {
    const { advance } = await watch(after('CCD_BINNING', connection('Ok', true)))

    await advance(1)

    expect(await advance(2)).toEqual([])
  })

  it('carries the timeout and the words the driver gave it', async () => {
    const { started } = await watch(after('CCD_BINNING', connection('Ok', true, ' message="connected"')))

    expect(canonical(started[3]!)).toContain('message="connected"')
    expect(canonical(started[3]!)).toContain('timeout="60"')
  })

  it('is not part of the answer when only some of the answers had it', async () => {
    const recorded = after('CCD_BINNING', connection('Ok', true))
    const stream = insert(recorded, defined(recorded, 'CCD1') + 1, ['out', ask], recorded[defined(recorded, 'CONNECTION')]!)
    const { started } = await watch(stream)

    expect(summary(started)).not.toContain('setSwitchVector CONNECTION')
  })

  it('is not part of the answer when the driver reports the property again and again, as it does a position', async () => {
    const { started } = await watch(after('CCD_BINNING', connection('Ok', true), after('CCD_BINNING', connection('Busy', true))))

    expect(summary(started)).not.toContain('setSwitchVector CONNECTION')
  })

  it('is not part of the answer when the driver updates the property elsewhere in the recording, as it does a position', async () => {
    const stream = [...after('CCD_BINNING', connection('Ok', true)), ['out', '<pingRequest uid="1"/>'] as const, ['in', connection('Busy', true)] as const]
    const { started } = await watch(stream)

    expect(summary(started)).not.toContain('setSwitchVector CONNECTION')
  })

  it('stays part of the answer when another ask in the recording named the property', async () => {
    const recorded = after('CCD_BINNING', connection('Ok', true))
    const stream = insert(recorded, defined(recorded, 'CCD1') + 1, ['out', `<getProperties version="1.7" device="${cam}" name="CONNECTION"/>`], recorded[defined(recorded, 'CONNECTION')]!)
    const { started } = await watch(stream)

    expect(summary(started)).toContain('setSwitchVector CONNECTION')
  })
})
