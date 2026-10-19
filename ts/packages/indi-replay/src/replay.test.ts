import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fitsToImageBytes, readFitsHeader } from '@cria/fits'
import type { Clock } from './clock.js'
import type { Fault } from './faults.js'
import { endOfRecording, notInRecording, startReplay, type Replay } from './replay.js'
import { localSiderealHours } from './sidereal.js'
import { synthesizeTape, type SynthSpec } from './synthesize.js'
import { TapeError, loadTape, type TapeEvent } from './tape.js'

class ManualClock implements Clock {
  private timers: Array<{ readonly due: number; readonly run: () => void; cancelled: boolean }> = []

  constructor(private time: number) {}

  now = () => this.time

  after = (ms: number, run: () => void) => {
    const timer = { due: this.time + ms, run, cancelled: false }

    this.timers.push(timer)

    return () => {
      timer.cancelled = true
    }
  }

  advance(ms: number): void {
    const target = this.time + ms

    for (;;) {
      const due = this.timers.filter(timer => !timer.cancelled && timer.due <= target).sort((a, b) => a.due - b.due)[0]

      if (!due) break
      this.timers.splice(this.timers.indexOf(due), 1)
      this.time = due.due
      due.run()
    }
    this.time = target
  }
}

class Client {
  text = ''
  closed = false

  private constructor(readonly socket: net.Socket) {
    socket.on('data', chunk => void (this.text += chunk.toString('utf8')))
    socket.on('close', () => void (this.closed = true))
    socket.on('error', () => undefined)
  }

  static async connect(port: number): Promise<Client> {
    const socket = net.connect(port, '127.0.0.1')

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    return new Client(socket)
  }

  send(xml: string): void {
    this.socket.write(`${xml}\n`)
  }

  received(prefix: string): string[] {
    return [...this.text.matchAll(/<(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g)].map(match => match[0]).filter(element => element.startsWith(prefix))
  }

  async until(what: string, done: () => boolean, timeoutMs = 3000): Promise<void> {
    for (let waited = 0; !done(); waited += 5) {
      if (waited > timeoutMs) throw new Error(`Timed out waiting for ${what}; received ${this.text.slice(-500)}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  async quiet(ms = 60): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}

const camera = 'Synthetic Camera'
const mount = 'Synthetic Mount'
const focuser = 'Synthetic Focuser'
const startAt = Date.UTC(2026, 2, 1, 4, 0, 0)
const longitude = -75

const sensor = { width: 160, height: 128 }

const spec: SynthSpec = {
  focuser,
  sensor,
  exposureSeconds: 2,
  stars: [6, 6, 6, 0, 0, 0],
  site: { latitudeDegrees: 40, longitudeDegrees: longitude },
  startAt,
  pointing: { raHours: 3, decDegrees: 30 },
  tracking: { from: 0, until: 3 },
}

let directory: string
let clock: ManualClock
let replay: Replay | undefined
let clients: Client[] = []

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'indi-replay-'))
  clock = new ManualClock(Date.UTC(2026, 9, 18, 22, 0, 0))
})

afterEach(async () => {
  await replay?.stop()
  replay = undefined
  for (const client of clients) client.socket.destroy()
  clients = []
  await rm(directory, { recursive: true, force: true })
})

async function serve(options: { faults?: ReadonlyArray<Fault>; spec?: SynthSpec; toFrame?: number } = {}) {
  const folder = await synthesizeTape(options.spec ?? spec, join(directory, 'tape'))
  const tape = await loadTape(folder)

  replay = await startReplay(tape, { clock, ...(options.faults ? { faults: options.faults } : {}), ...(options.toFrame === undefined ? {} : { toFrame: options.toFrame }) })

  return { tape, folder }
}

async function connect(blobs = true) {
  const client = await Client.connect(replay!.port)

  clients.push(client)
  if (blobs) client.send(`<enableBLOB device="${camera}">Also</enableBLOB>`)
  client.send('<getProperties version="1.7"/>')
  await client.until('every definition', () => client.received('<defSwitchVector device="Synthetic Focuser" name="FOCUS_ABORT_MOTION"').length > 0)

  return client
}

const exposure = (client: Client, seconds: number) =>
  client.send(`<newNumberVector device="${camera}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">${seconds}</oneNumber></newNumberVector>`)

/** Asks for an exposure and waits until the replay has reserved its frame, so the clock may then be moved. */
async function begin(client: Client, seconds: number) {
  const before = replay!.cursor()

  exposure(client, seconds)
  await client.until('the exposure to start', () => replay!.cursor() === before + 1)
}

const states = (client: Client, device: string, name: string) =>
  client.received(`<setNumberVector device="${device}" name="${name}"`).map(element => /state="(\w+)"/.exec(element)![1]!)

const images = (client: Client) => client.received('<setBLOBVector').map(element => Buffer.from(/<oneBLOB[^>]*>([\s\S]*)<\/oneBLOB>/.exec(element)![1]!.replace(/\s/g, ''), 'base64'))

const pixels = (fits: Buffer) => fitsToImageBytes(fits, sensor).bytes

describe('loading a recording', () => {
  it('finds the camera, its frames and their sizes', async () => {
    const { tape } = await serve()

    expect(tape.camera).toBe(camera)
    expect(tape.frames.map(frame => [frame.index, frame.width, frame.height, frame.format])).toEqual(
      [0, 1, 2, 3, 4, 5].map(index => [index, sensor.width, sensor.height, '.fits']),
    )
    expect(tape.kinds.get(mount)).toBe('mount')
  })

  it('refuses a recording with a missing image', async () => {
    const folder = await synthesizeTape(spec, join(directory, 'tape'))

    await rm(join(folder, 'blobs', (await readdir(join(folder, 'blobs')))[0]!))
    await expect(loadTape(folder)).rejects.toThrow(TapeError)
  })

  it('refuses an image whose XML names a file the message does not list', async () => {
    const folder = await synthesizeTape(spec, join(directory, 'tape'))
    const traffic = await readFile(join(folder, 'traffic.jsonl'), 'utf8')

    await writeFile(join(folder, 'traffic.jsonl'), traffic.replace('ref=\\"blobs/1-', 'ref=\\"../../x/1-'))
    await expect(loadTape(folder)).rejects.toThrow(/not one of the message's recorded images/)
  })

  it('refuses a recording without images', async () => {
    const folder = await synthesizeTape({ ...spec, stars: [] }, join(directory, 'tape'))

    await expect(loadTape(folder)).rejects.toThrow(/holds no CCD1 image/)
  })
})

describe('discovery', () => {
  it('answers every getProperties from current values, for the whole connection', async () => {
    await serve()
    const client = await connect()

    for (let round = 0; round < 25; round++) {
      const before = client.received('<defSwitchVector device="Synthetic Mount" name="TELESCOPE_TRACK_STATE"').length

      client.send(`<getProperties version="1.7" device="${mount}" name="TELESCOPE_TRACK_STATE"/>`)
      await client.until('an answer', () => client.received('<defSwitchVector device="Synthetic Mount" name="TELESCOPE_TRACK_STATE"').length === before + 1)
    }
  })

  it('answers with the values a client wrote, not the recorded ones', async () => {
    await serve()
    const client = await connect()

    client.send(`<newNumberVector device="${camera}" name="CCD_BINNING"><oneNumber name="HOR_BIN">2</oneNumber><oneNumber name="VER_BIN">2</oneNumber></newNumberVector>`)
    await client.until('the echo', () => states(client, camera, 'CCD_BINNING').length > 0)
    client.send(`<getProperties version="1.7" device="${camera}" name="CCD_BINNING"/>`)
    await client.until('the definition', () => client.received(`<defNumberVector device="${camera}" name="CCD_BINNING"`).length === 2)

    expect(client.received(`<defNumberVector device="${camera}" name="CCD_BINNING"`)[1]).toContain('<defNumber name="HOR_BIN" label="HOR_BIN" format="%g" min="1" max="4" step="1">2</defNumber>')
  })

  it('defines TIME_LST on the mount from the first source frame and the recorded longitude', async () => {
    await serve()
    const client = await connect()
    const definition = client.received(`<defNumberVector device="${mount}" name="TIME_LST"`)[0]!
    const lst = Number(/<defNumber name="LST"[^>]*>([^<]*)</.exec(definition)![1])

    expect(lst).toBeCloseTo(localSiderealHours(startAt + 1000, longitude), 2)
  })
})

describe('writes', () => {
  it('echoes a write, honours a switch rule, and keeps the value against later recorded updates', async () => {
    await serve()
    const client = await connect()
    const track = (on: boolean) =>
      `<newSwitchVector device="${mount}" name="TELESCOPE_TRACK_STATE"><oneSwitch name="TRACK_ON">${on ? 'On' : 'Off'}</oneSwitch><oneSwitch name="TRACK_OFF">${on ? 'Off' : 'On'}</oneSwitch></newSwitchVector>`

    client.send(track(false))
    await client.until('the echo', () => client.received(`<setSwitchVector device="${mount}" name="TELESCOPE_TRACK_STATE"`).length === 1)
    expect(client.received(`<setSwitchVector device="${mount}" name="TELESCOPE_TRACK_STATE"`)[0]).toContain('state="Ok"')
    expect(replay!.value(mount, 'TELESCOPE_TRACK_STATE', 'TRACK_ON')).toBe(false)
    expect(replay!.value(mount, 'TELESCOPE_TRACK_STATE', 'TRACK_OFF')).toBe(true)

    client.send(track(true))
    await client.until('the second echo', () => client.received(`<setSwitchVector device="${mount}" name="TELESCOPE_TRACK_STATE"`).length === 2)
    for (let frame = 0; frame < 4; frame++) {
      await begin(client, 1)
      clock.advance(1000)
      await client.until(`frame ${frame}`, () => replay!.phase() === 'idle' && replay!.cursor() === frame + 1)
    }

    expect(replay!.value(mount, 'TELESCOPE_TRACK_STATE', 'TRACK_ON')).toBe(true)
  })

  it('lets the recording drive a property no client wrote', async () => {
    await serve()
    const client = await connect()

    for (let frame = 0; frame < 4; frame++) {
      await begin(client, 1)
      clock.advance(1000)
      await client.until(`frame ${frame}`, () => replay!.phase() === 'idle' && replay!.cursor() === frame + 1)
    }

    expect(replay!.value(mount, 'TELESCOPE_TRACK_STATE', 'TRACK_ON')).toBe(false)
  })
})

describe('an exposure', () => {
  it('goes Busy, waits the requested time, then sends the next source frame stamped with it to the clients that asked, and Ok', async () => {
    const { tape } = await serve()
    const asking = await connect()
    const other = await connect(false)
    const requestedAt = clock.now()

    await begin(asking, 1.5)
    await asking.until('Busy', () => states(asking, camera, 'CCD_EXPOSURE').includes('Busy'))
    expect(replay!.phase()).toBe('exposing')
    expect(replay!.cursor()).toBe(1)

    clock.advance(1499)
    await asking.quiet()
    expect(images(asking)).toEqual([])

    clock.advance(1)
    await asking.until('the image and Ok', () => states(asking, camera, 'CCD_EXPOSURE').at(-1) === 'Ok')
    await other.until('Ok', () => states(other, camera, 'CCD_EXPOSURE').at(-1) === 'Ok')

    const [sent] = images(asking)
    const { cards } = readFitsHeader(sent!)

    expect(images(asking)).toHaveLength(1)
    expect(images(other)).toEqual([])
    expect(states(asking, camera, 'CCD_EXPOSURE')).toEqual(['Busy', 'Ok'])
    expect(cards.get('EXPTIME')).toBe('1.5')
    expect(cards.get('DATE-OBS')).toBe(new Date(requestedAt).toISOString().slice(0, -1))
    expect(pixels(sent!)).toEqual(pixels(await readFile(tape.frames[0]!.path)))
    expect(asking.text.indexOf('</setBLOBVector>')).toBeLessThan(asking.text.lastIndexOf('state="Ok"'))
  })

  it('serves the frames in recorded order', async () => {
    const { tape } = await serve()
    const client = await connect()

    for (let frame = 0; frame < 3; frame++) {
      await begin(client, 1)
      clock.advance(1000)
      await client.until(`frame ${frame}`, () => images(client).length === frame + 1)
    }

    expect(images(client).map(pixels)).toEqual(await Promise.all(tape.frames.slice(0, 3).map(async frame => pixels(await readFile(frame.path)))))
  })

  it('refuses a camera set to a geometry the next frame does not have, and does not use the frame up', async () => {
    await serve()
    const client = await connect()

    client.send(`<newNumberVector device="${camera}" name="CCD_BINNING"><oneNumber name="HOR_BIN">2</oneNumber><oneNumber name="VER_BIN">2</oneNumber></newNumberVector>`)
    await client.until('the echo', () => states(client, camera, 'CCD_BINNING').length > 0)
    exposure(client, 1)
    await client.until('Alert', () => states(client, camera, 'CCD_EXPOSURE').includes('Alert'))

    expect(client.received(`<setNumberVector device="${camera}" name="CCD_EXPOSURE" state="Alert"`)[0]).toContain('message="frame 0 is 160x128; the camera is set to 80x64"')
    expect(replay!.cursor()).toBe(0)
    expect(replay!.phase()).toBe('idle')
  })

  it('refuses a second exposure while one runs', async () => {
    await serve()
    const client = await connect()

    await begin(client, 5)
    exposure(client, 5)
    await client.until('Alert', () => states(client, camera, 'CCD_EXPOSURE').includes('Alert'))

    expect(replay!.cursor()).toBe(1)
  })

  it('an abort ends it Idle, sends no late image, and the frame stays used', async () => {
    const { tape } = await serve()
    const client = await connect()

    await begin(client, 3)
    clock.advance(1000)
    client.send(`<newSwitchVector device="${camera}" name="CCD_ABORT_EXPOSURE"><oneSwitch name="ABORT">On</oneSwitch></newSwitchVector>`)
    await client.until('Idle', () => states(client, camera, 'CCD_EXPOSURE').at(-1) === 'Idle')
    clock.advance(60_000)
    await client.quiet()

    expect(images(client)).toEqual([])
    expect(replay!.events().map(event => event.kind)).toEqual(['reserved', 'aborted'])

    await begin(client, 1)
    clock.advance(1000)
    await client.until('the next frame', () => images(client).length === 1)

    expect(pixels(images(client)[0]!)).toEqual(pixels(await readFile(tape.frames[1]!.path)))
  })

  it('an abort stops an image being written to a client that is not reading, and closes that connection', async () => {
    const big: SynthSpec = { ...spec, sensor: { width: 2400, height: 1800 }, stars: [3, 3] }

    await serve({ spec: big })
    const slow = await connect()
    const aborting = await connect(false)

    slow.socket.pause()
    await begin(slow, 1)
    clock.advance(1000)
    await slow.quiet(300)
    aborting.send(`<newSwitchVector device="${camera}" name="CCD_ABORT_EXPOSURE"><oneSwitch name="ABORT">On</oneSwitch></newSwitchVector>`)
    await aborting.until('Idle', () => states(aborting, camera, 'CCD_EXPOSURE').at(-1) === 'Idle')

    const closed = new Promise<void>(resolve => slow.socket.once('close', () => resolve()))

    slow.socket.resume()
    await closed

    expect(slow.text).not.toContain('</setBLOBVector>')
  })

  it('past the last frame goes Busy, then Alert "end of recording", and sends nothing', async () => {
    await serve({ toFrame: 2 })
    const client = await connect()

    for (let frame = 0; frame < 2; frame++) {
      await begin(client, 1)
      clock.advance(1000)
      await client.until(`frame ${frame}`, () => images(client).length === frame + 1)
    }

    exposure(client, 1)
    await client.until('the end', () => replay!.phase() === 'ended')
    await client.until('Alert', () => states(client, camera, 'CCD_EXPOSURE').at(-1) === 'Alert')

    expect(states(client, camera, 'CCD_EXPOSURE').slice(-2)).toEqual(['Busy', 'Alert'])
    expect(client.received(`<setNumberVector device="${camera}" name="CCD_EXPOSURE" state="Alert"`).at(-1)).toContain(`message="${endOfRecording}"`)
    clock.advance(10_000)
    await client.quiet()
    expect(images(client)).toHaveLength(2)
  })
})

describe('the frame cursor drives the rest of the rig', () => {
  it('puts the mount where the recording had it when each frame arrived, and its sidereal time with it', async () => {
    const { tape } = await serve()
    const client = await connect()
    const hourAngles: number[] = []

    for (let frame = 0; frame < 6; frame++) {
      await begin(client, 1)
      const lst = Number(replay!.value(mount, 'TIME_LST', 'LST'))
      const ra = Number(replay!.value(mount, 'EQUATORIAL_EOD_COORD', 'RA'))

      expect(lst).toBeCloseTo(localSiderealHours(tape.frames[frame]!.at, longitude), 9)
      hourAngles.push(lst - ra)
      clock.advance(1000)
      await client.until(`frame ${frame}`, () => replay!.phase() === 'idle')
    }

    const steps = hourAngles.slice(1).map((angle, index) => angle - hourAngles[index]!)

    // Four seconds between frames: tracking, the hour angle grows by four sidereal seconds. The recording's
    // mount stopped tracking as frame 3 began, so from frame 3 on the hour angle holds.
    expect(steps.map(step => Math.round(step * 3600 * 100) / 100 + 0)).toEqual([4.01, 4.01, 4.01, 0, 0])
  })
})

describe('when the camera goes away and comes back', () => {
  it('brings back what a client wrote, and serves the next frame', async () => {
    const folder = await synthesizeTape(spec, join(directory, 'tape'))
    const tape = await loadTape(folder)
    const after = tape.frames[0]!.t
    const definitions = tape.events.filter(event => event.kind === 'define' && event.vector.device === camera)
    const events: TapeEvent[] = [
      ...tape.events.filter(event => event.t <= after),
      { t: after + 1, at: tape.frames[0]!.at + 1, kind: 'delete', device: camera, name: undefined },
      ...definitions.map(event => ({ ...event, t: after + 2, at: tape.frames[0]!.at + 2 })),
      ...tape.events.filter(event => event.t > after),
    ]

    replay = await startReplay({ ...tape, events }, { clock })
    const client = await connect()

    client.send(`<newSwitchVector device="${camera}" name="CCD_FRAME_TYPE"><oneSwitch name="FRAME_DARK">On</oneSwitch></newSwitchVector>`)
    await client.until('the echo', () => replay!.value(camera, 'CCD_FRAME_TYPE', 'FRAME_DARK') === true)
    await begin(client, 1)
    clock.advance(1000)
    await client.until('frame 0', () => images(client).length === 1)
    await begin(client, 1)
    clock.advance(1000)
    await client.until('frame 1', () => images(client).length === 2)

    expect(replay.value(camera, 'CCD_FRAME_TYPE', 'FRAME_DARK')).toBe(true)
    expect(replay.value(camera, 'CCD_FRAME_TYPE', 'FRAME_LIGHT')).toBe(false)
  })
})

describe('what would move hardware', () => {
  it('refuses a goto, a park and a focuser move, and does not echo them', async () => {
    await serve()
    const client = await connect()

    client.send(`<newNumberVector device="${mount}" name="EQUATORIAL_EOD_COORD"><oneNumber name="RA">5</oneNumber><oneNumber name="DEC">10</oneNumber></newNumberVector>`)
    client.send(`<newSwitchVector device="${mount}" name="TELESCOPE_PARK"><oneSwitch name="PARK">On</oneSwitch></newSwitchVector>`)
    client.send(`<newNumberVector device="${focuser}" name="ABS_FOCUS_POSITION"><oneNumber name="FOCUS_ABSOLUTE_POSITION">9000</oneNumber></newNumberVector>`)
    await client.until('three Alerts', () => client.received('<set').filter(element => element.includes('state="Alert"')).length === 3)

    expect(client.received('<set').map(element => [/name="(\w+)"/.exec(element)![1], /message="([^"]*)"/.exec(element)![1]])).toEqual([
      ['EQUATORIAL_EOD_COORD', notInRecording],
      ['TELESCOPE_PARK', notInRecording],
      ['ABS_FOCUS_POSITION', notInRecording],
    ])
    expect(replay!.value(mount, 'EQUATORIAL_EOD_COORD', 'RA')).toBe('3')
    expect(replay!.value(focuser, 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION')).toBe('5000')
  })

  it('confirms a stop: a motion that was Busy goes Idle and the request answers Ok', async () => {
    await serve({ faults: [{ at: 0, kind: 'set', device: mount, property: 'EQUATORIAL_EOD_COORD', state: 'Busy', values: {} }] })
    const client = await connect()

    exposure(client, 1)
    await client.until('Busy mount', () => client.received(`<setNumberVector device="${mount}" name="EQUATORIAL_EOD_COORD" state="Busy"`).length === 1)
    client.send(`<newSwitchVector device="${mount}" name="TELESCOPE_ABORT_MOTION"><oneSwitch name="ABORT">On</oneSwitch></newSwitchVector>`)
    await client.until('the stop', () => client.received(`<setSwitchVector device="${mount}" name="TELESCOPE_ABORT_MOTION" state="Ok"`).length === 1)

    expect(states(client, mount, 'EQUATORIAL_EOD_COORD')).toEqual(['Busy', 'Idle'])
    client.send(`<newSwitchVector device="${focuser}" name="FOCUS_ABORT_MOTION"><oneSwitch name="ABORT">On</oneSwitch></newSwitchVector>`)
    await client.until('the focuser stop', () => client.received(`<setSwitchVector device="${focuser}" name="FOCUS_ABORT_MOTION" state="Ok"`).length === 1)
  })
})

describe('faults', () => {
  it('blank turns the frames flat and leaves the others alone', async () => {
    const { tape } = await serve({ faults: [{ at: 1, kind: 'blank', count: 2 }] })
    const client = await connect()

    for (let frame = 0; frame < 4; frame++) {
      await begin(client, 1)
      clock.advance(1000)
      await client.until(`frame ${frame}`, () => images(client).length === frame + 1)
    }

    const flat = (fits: Buffer) => new Set(Array.from({ length: sensor.width * sensor.height }, (_, pixel) => pixels(fits).readUInt16LE(44 + pixel * 2))).size === 1
    const sent = images(client)

    expect(sent.map(flat)).toEqual([false, true, true, false])
    expect(sent.map(pixels)).not.toEqual(await Promise.all(tape.frames.slice(0, 4).map(async frame => pixels(await readFile(frame.path)))))
    expect(pixels(sent[0]!)).toEqual(pixels(await readFile(tape.frames[0]!.path)))
    expect(pixels(sent[3]!)).toEqual(pixels(await readFile(tape.frames[3]!.path)))
  })

  it('silent stops a device answering for the time given, in real time, then restores it', async () => {
    await serve({ faults: [{ at: 0, kind: 'silent', device: mount, forMs: 2500 }] })
    const client = await connect()
    const asked = () => client.received(`<defSwitchVector device="${mount}" name="CONNECTION"`).length

    await begin(client, 1)
    const before = asked()

    client.send(`<getProperties version="1.7" device="${mount}" name="CONNECTION"/>`)
    await client.quiet()
    expect(asked()).toBe(before)

    clock.advance(2499)
    client.send(`<getProperties version="1.7" device="${mount}" name="CONNECTION"/>`)
    await client.quiet()
    expect(asked()).toBe(before)

    clock.advance(1)
    client.send(`<getProperties version="1.7" device="${mount}" name="CONNECTION"/>`)
    await client.until('an answer again', () => asked() === before + 1)
  })

  it('silent at before-blob on the camera loses the image and the Ok', async () => {
    await serve({ faults: [{ at: 0, phase: 'before-blob', kind: 'silent', device: camera, forMs: 60_000 }] })
    const client = await connect()

    await begin(client, 1)
    clock.advance(1000)
    await client.quiet(150)

    expect(images(client)).toEqual([])
    expect(states(client, camera, 'CCD_EXPOSURE')).toEqual(['Busy'])
    expect(replay!.events().map(event => event.kind)).toEqual(['reserved', 'fault', 'delivered'])
  })

  it('disconnect closes the connections and refuses new ones for the time given', async () => {
    await serve({ faults: [{ at: 0, kind: 'disconnect', forMs: 500 }] })
    const client = await connect()

    exposure(client, 1)
    await client.until('closed', () => client.closed)

    const refused = await Client.connect(replay!.port)

    await refused.until('closed', () => refused.closed)
    clock.advance(500)

    const again = await Client.connect(replay!.port)

    clients.push(again)
    again.send(`<getProperties version="1.7" device="${mount}" name="CONNECTION"/>`)
    await again.until('an answer', () => again.received('<defSwitchVector').length === 1)
  })

  it('set takes the values, announces them, and keeps them against the recording', async () => {
    await serve({ faults: [{ at: 0, kind: 'set', device: mount, property: 'TELESCOPE_TRACK_STATE', values: { TRACK_ON: false, TRACK_OFF: true } }] })
    const client = await connect()

    exposure(client, 1)
    await client.until('the announcement', () => client.received(`<setSwitchVector device="${mount}" name="TELESCOPE_TRACK_STATE"`).length === 1)
    clock.advance(1000)
    expect(replay!.value(mount, 'TELESCOPE_TRACK_STATE', 'TRACK_ON')).toBe(false)
  })
})
