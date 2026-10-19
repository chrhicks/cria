import net from 'node:net'
import { Effect, Option } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { makeIndiClient } from './client.js'
import { ProblemLog } from './problems.js'
import type { TappedConnection, TappedMessage } from './tap.js'
import { IndiFramer } from './xml.js'

// All names, values and text in this file are invented.
const stamp = 'timestamp="2030-01-01T00:00:00"'
const good = (device = 'Test Focuser', name = 'POSITION') =>
  `<defNumberVector device="${device}" name="${name}" label="Position" group="Main" state="Idle" perm="rw" timeout="0" ${stamp}><defNumber name="STEPS" label="Steps" format="%g" min="0" max="100" step="1">5</defNumber></defNumberVector>`
const text = (bytes: Buffer | string) => Buffer.concat([Buffer.from('<defTextVector device="D" name="N" state="Idle" perm="ro"><defText name="T">'), Buffer.from(bytes), Buffer.from('</defText></defTextVector>')])

/** Frames `wire`, then a good element after it, to show the bad one did not cost the next. */
function frame(wire: Buffer | string) {
  const framer = new IndiFramer()
  const result = framer.frame(Buffer.concat([Buffer.from(wire), Buffer.from(good())]), true)

  return { ...result, framer }
}

describe('what the framer and parser do with unexpected input', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['an element with no device attribute', '<defTextVector name="N" state="Idle" perm="ro"><defText name="T">v</defText></defTextVector>', /missing device/],
    ['an empty device', '<defTextVector device="" name="N" state="Idle" perm="ro"/>', /empty device/],
    ['an empty name', '<defSwitchVector device="D" name="" state="Idle" perm="rw" rule="OneOfMany"/>', /empty name/],
    ['an empty element name', '<defTextVector device="D" name="N" state="Idle" perm="ro"><defText name="">v</defText></defTextVector>', /empty name/],
    ['a delProperty with no device', '<delProperty name="N"/>', /missing device/],
    ['an unknown element type', '<bogus device="D" name="N"/>', /Unknown INDI element <bogus>/],
    ['an unknown vector type', '<defFooVector device="D" name="N"/>', /Unknown INDI element <defFooVector>/],
    ['a number with junk text', '<defNumberVector device="D" name="N" state="Idle" perm="ro"><defNumber name="n" min="0" max="1" step="1">12abc</defNumber></defNumberVector>', /Invalid INDI number "12abc"/],
    ['a number update that is not a number', '<setNumberVector device="D" name="N"><oneNumber name="n">nan</oneNumber></setNumberVector>', /Invalid INDI number "nan"/],
    ['a state it does not know', '<defTextVector device="D" name="N" state="Broken" perm="ro"/>', /Unknown INDI state Broken/],
    ['a switch state it does not know', '<setSwitchVector device="D" name="N" state="Sideways"/>', /Unknown INDI state Sideways/],
    ['a permission it does not know', '<defTextVector device="D" name="N" state="Idle" perm="xx"/>', /Unknown INDI permission xx/],
    ['a switch value it does not know', '<setSwitchVector device="D" name="N"><oneSwitch name="s">Maybe</oneSwitch></setSwitchVector>', /Unknown INDI switch value "Maybe"/],
    ['a light state it does not know', '<setLightVector device="D" name="N"><oneLight name="l">Purple</oneLight></setLightVector>', /Unknown INDI state Purple/],
  ]

  it.each(cases)('skips %s, keeps its bytes, and reads the next element', (_, wire, reason) => {
    const { elements, stopped } = frame(wire)

    expect(stopped).toBeUndefined()
    expect(elements).toHaveLength(2)
    expect(elements[0]!.message).toBeUndefined()
    expect(elements[0]!.problem).toMatchObject({ scope: 'element', reason: expect.stringMatching(reason) })
    expect(elements[0]!.xml).toBe(wire)
    expect(elements[1]!.message).toMatchObject({ type: 'def', vector: { device: 'Test Focuser' } })
  })

  it('does not call a <message> a problem, and does not mind a rule it does not know', () => {
    const wire = '<message device="D" message="hello"/><defSwitchVector device="D" name="N" state="Idle" perm="rw" rule="Whatever"><defSwitch name="s">Off</defSwitch></defSwitchVector>'
    const { elements } = frame(wire)

    expect(elements.map(element => element.problem)).toEqual([undefined, undefined, undefined])
    expect(elements[1]!.message).toMatchObject({ type: 'def', vector: { kind: 'switch' } })
  })

  it('names the device, property and tag of a bad element so it can be found again', () => {
    const { elements } = frame('<setNumberVector device="Test Mount" name="COORDS"><oneNumber name="RA">1x</oneNumber></setNumberVector>')

    expect(elements[0]!.problem).toMatchObject({ tag: 'setNumberVector', device: 'Test Mount', name: 'COORDS', utf8: true })
  })

  it('shows at most a short excerpt, with control characters escaped and no BLOB payload', () => {
    const long = frame(text(`${'x'.repeat(5000)}\u0007`)).elements[0]!
    const blob = frame(`<setBLOBVector device="D" name="CCD1" state="Broken"><oneBLOB name="CCD1" size="9" format=".fits">${'QUJD'.repeat(500)}</oneBLOB></setBLOBVector>`).elements[0]!

    expect(long.problem).toBeUndefined()
    expect(blob.problem?.reason).toMatch(/Unknown INDI state/)
    expect(blob.problem!.excerpt).not.toContain('QUJD')
    expect(blob.problem!.excerpt.length).toBeLessThan(260)
    expect(blob.xml).toBe('<setBLOBVector device="D" name="CCD1" state="Broken"><oneBLOB name="CCD1" size="9" format=".fits"/></setBLOBVector>')
    const junk = frame(`<defTextVector device="D" name="N" state="Nope" perm="ro">${'y'.repeat(5000)}\u0007</defTextVector>`).elements[0]!.problem!

    expect(junk.excerpt.length).toBeLessThan(260)
    expect(junk.excerpt).not.toContain('\u0007')
    expect(junk.bytes).toBeGreaterThan(5000)
  })

  it('keeps every BLOB payload for the recording, whether or not the vector validates', () => {
    const payload = Buffer.from('ABC')
    const vector = (state: string, body: string) => `<setBLOBVector device="D" name="CCD1" state="${state}">${body}</setBLOBVector>`
    const one = `<oneBLOB name="CCD1" size="3" format=".fits">${payload.toString('base64')}</oneBLOB>`
    const empty = '<oneBLOB name="CCD2" size="0" format=".fits"/>'

    const bad = frame(vector('Broken', one)).elements[0]!
    const mixed = frame(vector('Broken', `${one}${empty}${one}`)).elements[0]!
    const valid = frame(vector('Ok', `${one}${empty}${one}`)).elements[0]!

    expect(bad.problem).toBeDefined()
    expect(bad.blobs).toEqual([payload])
    expect(bad.xml).toBe(vector('Broken', '<oneBLOB name="CCD1" size="3" format=".fits"/>'))
    // The same payloads in the same positions as a vector that validates.
    expect(mixed.blobs).toEqual(valid.blobs)
    expect(valid.blobs.map(blob => blob.length)).toEqual([3, 0, 3])
  })

  it('keeps a large valid BLOB byte for byte, and a bad one too', () => {
    const image = Buffer.alloc(3 * 1024 * 1024)

    for (let i = 0; i < image.length; i += 1) image[i] = (i * 31 + (i >> 8)) & 0xff
    const wire = (state: string) => `<setBLOBVector device="D" name="CCD1" state="${state}"><oneBLOB name="CCD1" size="${image.length}" format=".fits">${image.toString('base64')}</oneBLOB></setBLOBVector>`
    const chunks = (text: string) => Array.from({ length: Math.ceil(text.length / 65536) }, (_, i) => Buffer.from(text.slice(i * 65536, (i + 1) * 65536)))

    for (const state of ['Ok', 'Broken']) {
      const framer = new IndiFramer()
      const elements = chunks(wire(state)).flatMap(chunk => framer.pushFramed(chunk))

      expect(elements).toHaveLength(1)
      expect(Buffer.compare(elements[0]!.blobs[0]!, image)).toBe(0)
      expect(elements[0]!.xml).toBe(`<setBLOBVector device="D" name="CCD1" state="${state}"><oneBLOB name="CCD1" size="${image.length}" format=".fits"/></setBLOBVector>`)
    }
  })

  it('reads invalid UTF-8 as replacement characters without failing, and says so when it is part of a bad element', () => {
    const { elements } = frame(text(Buffer.from([0x61, 0xff, 0xfe, 0x62])))

    expect(elements[0]!.problem).toBeUndefined()
    expect(elements[0]!.message).toMatchObject({ vector: { elements: [{ value: 'a��b' }] } })
    const bad = frame(Buffer.concat([Buffer.from('<defTextVector device="D" name="N" state="Nope" perm="ro">'), Buffer.from([0xff]), Buffer.from('</defTextVector>')])).elements[0]!

    expect(bad.problem).toMatchObject({ utf8: false })
  })

  it('waits for the rest of an element cut short at the end of the stream, and says nothing', () => {
    const framer = new IndiFramer()
    const result = framer.frame(Buffer.from('<defTextVector device="D" name="N" state="Idle" perm="ro"><defText name="T">half'), true)

    expect(result).toEqual({ elements: [] })
    expect(framer.frame(Buffer.from('...'), true)).toEqual({ elements: [] })
  })

  it('stops, keeping what came before, when an element is cut short and the next one starts', () => {
    const { elements, stopped } = frame(`${good('Test Focuser', 'FIRST')}<defTextVector device="D" name="N" state="Idle" perm="ro"><defText name="T">v</defText>${text('later')}`)

    expect(elements).toHaveLength(2)
    expect(elements[0]!.message).toMatchObject({ vector: { name: 'FIRST' } })
    expect(stopped).toMatchObject({ scope: 'stream', reason: expect.stringMatching(/never closed/) })
  })

  it('stops at a huge element that does not close, and still lets a big BLOB through', () => {
    const framer = () => new IndiFramer({ element: 1000, blob: 5000 })
    const unclosed = framer().frame(Buffer.from(`<defTextVector device="D" name="N" state="Idle" perm="ro"><defText name="T">${'x'.repeat(2000)}`), true)
    const blob = framer().frame(Buffer.from(`<setBLOBVector device="D" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="3000" format=".fits">${'QUJD'.repeat(500)}`), true)

    expect(unclosed.stopped).toMatchObject({ scope: 'stream', reason: expect.stringMatching(/larger than 1000 bytes/) })
    expect(blob.stopped).toBeUndefined()
    expect(framer().frame(Buffer.from(`<setBLOBVector device="D" name="CCD1" state="Ok">${'x'.repeat(6000)}`), true).stopped).toMatchObject({ scope: 'stream' })
  })

  it('stops at a tag that is not a tag, and reads nothing more', () => {
    const { elements, stopped, framer } = frame('<1bad device="D">')

    expect(elements).toHaveLength(0)
    expect(stopped).toMatchObject({ scope: 'stream', reason: expect.stringMatching(/Malformed INDI element/) })
    expect(framer.frame(Buffer.from(good()), true)).toMatchObject({ elements: [], stopped })
  })
})

describe('the problem log', () => {
  const problem = (name: string) => ({ scope: 'element' as const, reason: 'Invalid INDI number "x"', tag: 'setNumberVector', device: 'D', name, utf8: true, excerpt: '<setNumberVector/>', bytes: 18 })

  function logAt() {
    const lines: string[] = []
    const clock = { now: 1_000_000 }

    return { lines, clock, log: new ProblemLog({ warn: line => void lines.push(line), now: () => clock.now }) }
  }

  it('writes one line for a problem however often it repeats, then a summary a minute later', () => {
    const { lines, clock, log } = logAt()

    for (let i = 0; i < 1000; i += 1) log.report(problem('A'), 'skipped the element')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^INDI protocol error #1: skipped the element: Invalid INDI number "x"; <setNumberVector> device="D" name="A", 18 bytes: <setNumberVector\/>$/)
    clock.now += 61_000
    log.report(problem('A'), 'skipped the element')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('#1001')
    expect(lines[1]).toContain('(999 more since the last line)')
    expect(log.total).toBe(1001)
  })

  it('caps all the different problems together, and counts the ones it held back', () => {
    const { lines, clock, log } = logAt()

    for (let i = 0; i < 500; i += 1) log.report(problem(`P${i}`), 'skipped the element')
    expect(lines).toHaveLength(20)
    clock.now += 61_000
    log.report(problem('Z'), 'skipped the element')
    expect(lines).toHaveLength(21)
    expect(lines[20]).toContain('(480 more since the last line)')
  })
})

// ---------------------------------------------------------------- the client, against a server that sends what it is told

interface Fake {
  readonly port: number
  readonly connections: net.Socket[]
  readonly received: string[]
  readonly close: () => Promise<void>
}

const open: Fake[] = []

afterEach(async () => {
  await Promise.all(open.splice(0).map(fake => fake.close()))
})

async function fakeIndiserver(): Promise<Fake> {
  const connections: net.Socket[] = []
  const received: string[] = []
  const server = net.createServer(socket => {
    connections.push(socket)
    socket.on('data', chunk => received.push(chunk.toString()))
    socket.on('error', () => undefined)
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const fake = {
    port: (server.address() as net.AddressInfo).port,
    connections,
    received,
    close: async () => {
      for (const socket of connections) socket.destroy()
      await new Promise(resolve => server.close(resolve))
    },
  }

  open.push(fake)

  return fake
}

async function until(done: () => boolean) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > 3000) throw new Error('Timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('the client when indiserver sends something unexpected', () => {
  interface Context {
    readonly fake: Fake
    readonly warnings: string[]
    readonly tapped: TappedMessage[]
    readonly closed: TappedConnection[]
    readonly deleted: string[]
    readonly property: (name: string) => unknown
    /** The socket of the nth connection, once it is open. */
    readonly socket: (n: number) => Promise<net.Socket>
  }

  async function session(run: (context: Context) => Promise<void>, deviceName = 'Test Focuser') {
    const fake = await fakeIndiserver()
    const warnings: string[] = []
    const tapped: TappedMessage[] = []
    const closed: TappedConnection[] = []
    const deleted: string[] = []
    const tap = { message: (message: TappedMessage) => void tapped.push(message), connection: (connection: TappedConnection) => void closed.push(connection) }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeIndiClient({ host: '127.0.0.1', port: fake.port, tap, warn: line => void warnings.push(line) })
          const focuser = client.device(deviceName)
          const subscription = yield* focuser.subscribe

          yield* Effect.forkScoped(
            Effect.forever(
              Effect.flatMap(subscription.next, event => (event.type === 'deleted' ? Effect.sync(() => void deleted.push(event.name ?? '')) : Effect.void)),
            ),
          )
          yield* Effect.promise(() =>
            run({
              fake,
              warnings,
              tapped,
              closed,
              deleted,
              property: name => Option.getOrUndefined(Effect.runSync(focuser.property(name))),
              socket: async n => {
                await until(() => fake.connections.length >= n)

                return fake.connections[n - 1]!
              },
            }),
          )
        }),
      ),
    )
  }

  it('hands the recording the payload of a BLOB vector it could not validate, and keeps the connection', async () => {
    await session(async ({ warnings, tapped, closed, socket }) => {
      const first = await socket(1)

      first.write('<setBLOBVector device="Test Focuser" name="CCD1" state="Broken"><oneBLOB name="CCD1" size="3" format=".fits">QUJD</oneBLOB></setBLOBVector>')
      await until(() => tapped.some(message => message.dir === 'in'))

      const message = tapped.find(item => item.dir === 'in')!

      expect(message.xml).toBe('<setBLOBVector device="Test Focuser" name="CCD1" state="Broken"><oneBLOB name="CCD1" size="3" format=".fits"/></setBLOBVector>')
      expect(message.blobs.map(blob => blob.toString())).toEqual(['ABC'])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).not.toContain('QUJD')
      expect(closed.filter(item => item.status === 'closed')).toEqual([])
    })
  })

  it('skips a bad element, logs it once, keeps the connection and records every byte', async () => {
    await session(async ({ fake, warnings, tapped, closed, property, socket }) => {
      const junk = '<defNumberVector device="" name="" label="" group="" state="Idle" perm="ro" timeout="0"><defNumber name="" label="" format="" min="0" max="0" step="0">0</defNumber></defNumberVector>'
      const wire = [good('Test Focuser', 'A'), junk, junk, junk, good('Test Focuser', 'B')]
      const first = await socket(1)

      for (const element of wire) first.write(element)
      await until(() => tapped.filter(message => message.dir === 'in').length === 5)

      expect(fake.connections).toHaveLength(1)
      expect(closed.filter(item => item.status === 'closed')).toEqual([])
      expect(property('A')).toBeDefined()
      expect(property('B')).toBeDefined()
      expect(tapped.filter(message => message.dir === 'in').map(message => message.xml)).toEqual(wire)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('INDI protocol error #1: skipped the element: INDI element has an empty name')
      expect(warnings[0]).toContain('<defNumberVector> no device or name')
    })
  })

  it('forgets a property whose update it could not read, so no old value shows, and asks for it again once', async () => {
    await session(async ({ fake, warnings, deleted, property, socket }) => {
      const first = await socket(1)
      const bad = '<setNumberVector device="Test Focuser" name="POSITION" state="Ok"><oneNumber name="STEPS">12abc</oneNumber></setNumberVector>'

      first.write(good())
      await until(() => property('POSITION') !== undefined)
      first.write(bad + bad + bad)
      await until(() => property('POSITION') === undefined)
      await until(() => fake.received.join('').includes('<getProperties version="1.7" device="Test Focuser" name="POSITION"/>'))

      expect(deleted).toEqual(['POSITION'])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('device="Test Focuser" name="POSITION"')
      expect(warnings[0]).toContain('Invalid INDI number "12abc"')
      expect(fake.received.join('').match(/name="POSITION"\/>/g)).toHaveLength(1)

      first.write(good())
      await until(() => property('POSITION') !== undefined)
    })
  })

  it('forgets and re-requests a property whose device name is not ASCII, exactly as it names it', async () => {
    const device = 'Review é'

    await session(
      async ({ fake, warnings, deleted, property, socket }) => {
        const first = await socket(1)
        const define = `<defNumberVector device="${device}" name="CCD_TEMPERATURE" state="Idle" perm="ro"><defNumber name="TEMPERATURE" min="-50" max="50" step="1">-5</defNumber></defNumberVector>`
        const bad = `<setNumberVector device="${device}" name="CCD_TEMPERATURE" state="Ok"><oneNumber name="TEMPERATURE">junk</oneNumber></setNumberVector>`

        first.write(define)
        await until(() => property('CCD_TEMPERATURE') !== undefined)
        first.write(bad)
        await until(() => deleted.length > 0)
        await until(() => fake.received.join('').includes(`<getProperties version="1.7" device="${device}" name="CCD_TEMPERATURE"/>`))

        expect(property('CCD_TEMPERATURE')).toBeUndefined()
        expect(deleted).toEqual(['CCD_TEMPERATURE'])
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain(`device="${device}" name="CCD_TEMPERATURE"`)
      },
      device,
    )
  })

  it('names a device the way it reads a good element, invalid UTF-8 included', () => {
    const element = (wire: Buffer) => new IndiFramer().frame(wire, false).elements[0]!
    const named = (device: Buffer) =>
      Buffer.concat([Buffer.from('<setNumberVector device="'), device, Buffer.from('" name="N"><oneNumber name="n">1</oneNumber></setNumberVector>')])
    const broken = Buffer.from([0x44, 0xff, 0x45])

    // The same bytes, once good and once with the number spoiled: both must name the same device.
    const good = element(named(broken))
    const bad = element(Buffer.from(named(broken).toString('latin1').replace('>1<', '>x<'), 'latin1'))

    expect(good.message).toMatchObject({ vector: { device: 'D\ufffdE' } })
    expect(bad.problem).toMatchObject({ device: 'D\ufffdE', name: 'N' })
    expect(element(named(Buffer.from('é'))).message).toMatchObject({ vector: { device: 'é' } })
    expect(element(Buffer.from('<setNumberVector device="é" name="N"><oneNumber name="n">x</oneNumber></setNumberVector>')).problem).toMatchObject({ device: 'é' })
  })

  it('reads a character reference that is not a character as written, instead of ending the connection', async () => {
    await session(async ({ warnings, closed, property, socket }) => {
      const first = await socket(1)

      first.write(`<defTextVector device="Test Focuser" name="NOTE" state="Idle" perm="ro"><defText name="T">a&#x110000;b&#99999999999;</defText></defTextVector>${good()}`)
      await until(() => property('POSITION') !== undefined)

      expect(closed.filter(item => item.status === 'closed')).toEqual([])
      expect(warnings).toEqual([])
      expect(property('NOTE')).toMatchObject({ elements: new Map([['T', expect.objectContaining({ value: 'a&#x110000;b&#99999999999;' })]]) })
    })
  })

  it('drops the connection, logs why, and reconnects when the framing is lost', async () => {
    await session(async ({ fake, warnings, closed, property, socket }) => {
      const first = await socket(1)

      first.write(`${good('Test Focuser', 'BEFORE')}<defTextVector device="D" name="N" state="Idle" perm="ro"><defText name="T">v</defText>${text('later').toString()}`)
      await until(() => warnings.length === 1)
      await until(() => closed.some(item => item.status === 'closed'))
      await socket(2)

      expect(warnings[0]).toContain('INDI protocol error #1: dropped the connection: Incomplete INDI element')
      expect(fake.connections.length).toBeGreaterThanOrEqual(2)
      expect(property('BEFORE')).toBeDefined()
      expect(closed.find(item => item.status === 'closed')).toMatchObject({ error: expect.stringContaining('Incomplete INDI element') })
    })
  })
})
