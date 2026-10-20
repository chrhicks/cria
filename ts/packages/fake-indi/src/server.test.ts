import { readFileSync } from 'node:fs'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, type BlobMode } from './server.js'

let fake: FakeIndi
let sockets: net.Socket[] = []

beforeEach(async () => {
  fake = new FakeIndi({ receivedLimit: 3 })
  await fake.start()
  fake.define({ device: 'CCD', name: 'CCD1', kind: 'blob', perm: 'ro', state: 'Idle', elements: { CCD1: { value: '' } } })
  fake.define({
    device: 'Mount',
    name: 'TELESCOPE_PARK',
    kind: 'switch',
    perm: 'rw',
    rule: 'OneOfMany',
    label: 'Parking & more',
    group: 'Motion Control',
    timeout: 5,
    state: 'Ok',
    elements: { PARK: { value: false }, UNPARK: { value: true } },
  })
})

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets = []
  await fake.stop()
})

interface Client {
  readonly socket: net.Socket
  readonly text: () => string
  readonly send: (xml: string) => void
  readonly until: (what: string, done: (text: string) => boolean) => Promise<void>
}

async function connect(): Promise<Client> {
  const socket = net.connect(fake.port, '127.0.0.1')
  let text = ''

  sockets.push(socket)
  socket.on('data', chunk => void (text += chunk.toString('utf8')))
  await new Promise(resolve => socket.once('connect', resolve))

  return {
    socket,
    text: () => text,
    send: xml => void socket.write(xml),
    until: async (what, done) => {
      for (let waited = 0; !done(text); waited += 5) {
        if (waited > 3000) throw new Error(`Timed out waiting for ${what}; received ${text.slice(-300)}`)
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    },
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('definitions', () => {
  it('say what the vector says: label, group and timeout, escaped', async () => {
    const client = await connect()

    client.send('<getProperties version="1.7" device="Mount"/>')
    await client.until('the definition', text => text.includes('</defSwitchVector>'))

    expect(client.text()).toBe(
      '<defSwitchVector device="Mount" name="TELESCOPE_PARK" label="Parking &amp; more" group="Motion Control" state="Ok" perm="rw" rule="OneOfMany" timeout="5">\n' +
        '  <defSwitch name="PARK" label="PARK">Off</defSwitch>\n  <defSwitch name="UNPARK" label="UNPARK">On</defSwitch>\n</defSwitchVector>\n',
    )
  })

  it('raw sends the element as given to the clients that hear of the property, and leaves the fake\'s vector alone', async () => {
    const heard = await connect()
    const other = await connect()
    const bad = '<setNumberVector device="Mount" name="TELESCOPE_PARK" state="Ok"><oneNumber name="PARK">12abc</oneNumber></setNumberVector>\n'

    heard.send('<getProperties version="1.7" device="Mount"/>')
    other.send('<getProperties version="1.7" device="CCD"/>')
    await heard.until('the definition', text => text.includes('</defSwitchVector>'))
    await other.until('the definition', text => text.includes('<defBLOBVector'))
    fake.raw(bad, 'Mount', 'TELESCOPE_PARK')
    await heard.until('the raw element', text => text.endsWith(bad))
    await pause(50)

    expect(other.text()).not.toContain('12abc')
    expect(fake.vector('Mount', 'TELESCOPE_PARK').elements.PARK!.value).toBe(false)
  })

  it('carry a light vector', async () => {
    fake.define({ device: 'Weather', name: 'WEATHER_STATUS', kind: 'light', perm: 'ro', state: 'Ok', elements: { WEATHER_TEMPERATURE: { value: 'Ok', label: 'Temperature' } } })
    const client = await connect()

    client.send('<getProperties version="1.7" device="Weather"/>')
    await client.until('the definition', text => text.includes('</defLightVector>'))
    fake.update('Weather', 'WEATHER_STATUS', { state: 'Alert', values: { WEATHER_TEMPERATURE: 'Alert' } })
    await client.until('the update', text => text.includes('<oneLight name="WEATHER_TEMPERATURE">Alert</oneLight>'))

    expect(client.text()).toContain('<defLight name="WEATHER_TEMPERATURE" label="Temperature">Ok</defLight>')
  })
})

describe('images', () => {
  it('deliverBlob goes only to clients that enabled BLOBs for that device or property', async () => {
    const [off, device, property, other] = [await connect(), await connect(), await connect(), await connect()]

    device.send('<enableBLOB device="CCD">Also</enableBLOB>')
    property.send('<enableBLOB device="CCD" name="CCD1">Only</enableBLOB>')
    other.send('<enableBLOB device="CCD" name="CCD2">Also</enableBLOB>')
    await pause(50)

    expect(await fake.deliverBlob('CCD', 'CCD1', 'CCD1', Buffer.from('pixels'))).toBe(2)
    await device.until('the image', text => text.includes('</setBLOBVector>'))
    await property.until('the image', text => text.includes('</setBLOBVector>'))

    expect(off.text()).toBe('')
    expect(other.text()).toBe('')
    expect(device.text()).toBe(
      '<setBLOBVector device="CCD" name="CCD1" state="Ok">\n  <oneBLOB name="CCD1" size="6" format=".fits" len="6">\ncGl4ZWxz\n  </oneBLOB>\n</setBLOBVector>\n',
    )
  })

  it('a later Never switches the images off again', async () => {
    const client = await connect()

    client.send('<enableBLOB device="CCD">Also</enableBLOB>')
    client.send('<enableBLOB device="CCD">Never</enableBLOB>')
    await pause(50)

    expect(await fake.deliverBlob('CCD', 'CCD1', 'CCD1', Buffer.from('x'))).toBe(0)
  })

  it('writes a large image in chunks that arrive whole, and holds other elements until it is done', async () => {
    const client = await connect()
    const image = Buffer.alloc(3 * 1024 * 1024, 7)

    client.send('<enableBLOB device="CCD">Also</enableBLOB><getProperties version="1.7" device="Mount"/>')
    await pause(50)

    const delivery = fake.deliverBlob('CCD', 'CCD1', 'CCD1', image)

    fake.update('Mount', 'TELESCOPE_PARK', { state: 'Busy' })
    await delivery
    await client.until('the update after the image', text => text.includes('<setSwitchVector'))

    const text = client.text()
    const payload = text.slice(text.indexOf('size="') , text.indexOf('</oneBLOB>'))

    expect(text.indexOf('</setBLOBVector>')).toBeLessThan(text.indexOf('<setSwitchVector'))
    expect(Buffer.from(payload.slice(payload.indexOf('>') + 1), 'base64')).toEqual(image)
  })

  it('an aborted delivery to a client that is not reading ends the connection instead of finishing later', async () => {
    const client = await connect()
    const image = Buffer.alloc(24 * 1024 * 1024, 5)
    const controller = new AbortController()

    client.send('<enableBLOB device="CCD">Also</enableBLOB>')
    await pause(50)
    client.socket.pause()

    const delivery = fake.deliverBlob('CCD', 'CCD1', 'CCD1', image, { signal: controller.signal })

    await pause(200)
    controller.abort()
    await delivery
    const closed = new Promise<void>(resolve => client.socket.once('close', () => resolve()))

    client.socket.resume()
    await closed

    expect(client.text()).not.toContain('</setBLOBVector>')
  })

  it('an abort before the delivery starts sends nothing', async () => {
    const client = await connect()
    const controller = new AbortController()

    client.send('<enableBLOB device="CCD">Also</enableBLOB>')
    await pause(50)
    controller.abort()

    expect(await fake.deliverBlob('CCD', 'CCD1', 'CCD1', Buffer.from('x'), { signal: controller.signal })).toBe(0)
    await pause(50)
    expect(client.text()).toBe('')
  })

  it('sendBlob still broadcasts to every client, whatever they enabled', async () => {
    const client = await connect()

    fake.sendBlob('CCD', 'CCD1', 'CCD1', Buffer.from('x'))
    await client.until('the image', text => text.includes('</setBLOBVector>'))
  })
})

describe('enableBLOB Only on a whole device', () => {
  it('sends a client nothing but images for that device, and everything else as usual', async () => {
    fake.define({ device: 'Mount', name: 'TIME_LST', kind: 'number', perm: 'ro', state: 'Ok', elements: { LST: { value: 1 } } })
    const [only, also] = [await connect(), await connect()]

    only.send('<enableBLOB device="Mount">Only</enableBLOB><enableBLOB device="CCD">Only</enableBLOB>')
    also.send('<enableBLOB device="Mount">Also</enableBLOB><enableBLOB device="CCD">Also</enableBLOB>')
    await pause(50)

    fake.update('Mount', 'TELESCOPE_PARK', { state: 'Busy' })
    fake.define({ device: 'Mount', name: 'MOUNT_INFO', kind: 'text', perm: 'ro', state: 'Ok', elements: { NAME: { value: 'AM5' } } })
    fake.removeVector('Mount', 'TIME_LST')
    only.send('<getProperties version="1.7" device="Mount"/>')
    expect(await fake.deliverBlob('CCD', 'CCD1', 'CCD1', Buffer.from('pixels'))).toBe(2)
    await only.until('the image', text => text.includes('</setBLOBVector>'))
    await also.until('the image', text => text.includes('</setBLOBVector>'))
    await pause(50)

    expect(only.text()).toBe(
      '<setBLOBVector device="CCD" name="CCD1" state="Ok">\n  <oneBLOB name="CCD1" size="6" format=".fits" len="6">\ncGl4ZWxz\n  </oneBLOB>\n</setBLOBVector>\n',
    )
    expect(also.text()).toContain('<setSwitchVector device="Mount" name="TELESCOPE_PARK" state="Busy">')
    expect(also.text()).toContain('<defTextVector device="Mount" name="MOUNT_INFO"')
    expect(also.text()).toContain('<delProperty device="Mount" name="TIME_LST"/>')
  })
})

type Setting = readonly [mode: BlobMode, property?: string]

interface Delivered {
  /** Every definition, update and deletion reached the client (true) or none did (false). */
  readonly others: boolean
  /** The image of CCD1 reached the client. */
  readonly image: boolean
}

/**
 * Applies each row's `enableBLOB` settings on its own connection to one fake, sends everything a driver
 * does (definitions, updates, deletions, an image), and reports what each connection received.
 */
async function observe(rows: ReadonlyArray<ReadonlyArray<Setting>>): Promise<Delivered[]> {
  fake.define({ device: 'CCD', name: 'CONNECTION', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { CONNECT: { value: true }, DISCONNECT: { value: false } } })
  fake.define({ device: 'CCD', name: 'CCD_EXPOSURE', kind: 'number', perm: 'rw', state: 'Idle', elements: { CCD_EXPOSURE_VALUE: { value: 0 } } })
  const clients = await Promise.all(rows.map(() => connect()))
  const barrier = (uid: string) =>
    Promise.all(
      clients.map(async client => {
        client.send(`<pingRequest uid="${uid}"/>`)
        await client.until(`ping ${uid}`, text => text.includes(`<pingReply uid="${uid}"/>`))
      }),
    )

  rows.forEach((settings, index) => {
    for (const [mode, name] of settings) clients[index]!.send(`<enableBLOB device="CCD"${name ? ` name="${name}"` : ''}>${mode}</enableBLOB>`)
  })
  await barrier('enabled')
  for (const client of clients) {
    client.send('<getProperties version="1.7" device="CCD"/>')
    client.send('<getProperties version="1.7" device="CCD" name="CCD1"/>')
  }
  await barrier('subscribed')
  fake.update('CCD', 'CCD_EXPOSURE', { state: 'Busy' })
  fake.define({ device: 'CCD', name: 'CCD_TEMPERATURE', kind: 'number', perm: 'ro', state: 'Ok', elements: { CCD_TEMPERATURE_VALUE: { value: 1 } } })
  fake.removeVector('CCD', 'CCD_TEMPERATURE')
  await barrier('replied')
  await fake.deliverBlob('CCD', 'CCD1', 'CCD1', Buffer.from('pixels'))
  await barrier('done')

  return clients.map(client => {
    const received = client.text()
    const others = [
      received.includes('<defSwitchVector device="CCD" name="CONNECTION"'),
      received.includes('<defBLOBVector device="CCD" name="CCD1"'),
      received.includes('<setNumberVector device="CCD" name="CCD_EXPOSURE" state="Busy">'),
      received.includes('<defNumberVector device="CCD" name="CCD_TEMPERATURE"'),
      received.includes('<delProperty device="CCD" name="CCD_TEMPERATURE"/>'),
    ]

    expect(new Set(others).size, `either all of the definitions, update and deletion arrived or none: ${others}`).toBe(1)

    return { others: others[0]!, image: received.includes('<setBLOBVector device="CCD" name="CCD1"') }
  })
}

/**
 * What indiserver 2.2.5 delivered for sequences that mix device-wide and property-scoped `enableBLOB`,
 * measured with indi_simulator_ccd (measure/measure-enable-blob.py, PR #10). Only a device-wide `Only`
 * withholds definitions, updates and deletions. A device-wide command drops the device's property
 * settings, so it supersedes earlier ones; a property's setting beats the device's for its own image.
 * Each row here failed on the fake before it modelled that (the sequences that did not are only in the
 * exhaustive table below).
 */
const mixedRows: ReadonlyArray<readonly [string, ReadonlyArray<Setting>, Delivered]> = [
  ['CCD1 Only, then device Never', [['Only', 'CCD1'], ['Never']], { others: true, image: false }],
  ['CCD1 Also, then device Never', [['Also', 'CCD1'], ['Never']], { others: true, image: false }],
  ['CCD1 Never, then device Only', [['Never', 'CCD1'], ['Only']], { others: false, image: true }],
  ['CCD1 Never, then device Also', [['Never', 'CCD1'], ['Also']], { others: true, image: true }],
  ['device Also, then CCD1 Never, then device Only', [['Also'], ['Never', 'CCD1'], ['Only']], { others: false, image: true }],
  ['device Also, then CCD1 Never, then device Also', [['Also'], ['Never', 'CCD1'], ['Also']], { others: true, image: true }],
  ['device Only, then CCD1 Also, then device Never', [['Only'], ['Also', 'CCD1'], ['Never']], { others: true, image: false }],
  ['device Only, then CCD1 Never, then device Also', [['Only'], ['Never', 'CCD1'], ['Also']], { others: true, image: true }],
  ['device Never, then CCD1 Only, then device Never', [['Never'], ['Only', 'CCD1'], ['Never']], { others: true, image: false }],
]

describe('enableBLOB at device and property scope, as indiserver delivers it', () => {
  it.each(mixedRows)('%s', async (_title, settings, expected) => {
    expect(await observe([settings])).toEqual([expected])
  })

  it('matches every measured sequence of up to three commands', async () => {
    const measured: ReadonlyArray<{ sequence: ReadonlyArray<Setting>; withheld: boolean; image: boolean }> = JSON.parse(
      readFileSync(new URL('./enable-blob-sequences.json', import.meta.url), 'utf8'),
    ).map((row: { sequence: Array<[BlobMode, string | null]> }) => ({ ...row, sequence: row.sequence.map(([mode, name]) => (name === null ? [mode] : [mode, name])) }))
    const delivered = await observe(measured.map(row => row.sequence))
    const wrong = measured.flatMap((row, index) => {
      const got = delivered[index]!

      return got.others === !row.withheld && got.image === row.image ? [] : [`${JSON.stringify(row.sequence)}: indiserver ${row.withheld ? 'withholds' : 'sends'} definitions and ${row.image ? 'sends' : 'withholds'} the image; fake did ${got.others ? 'send' : 'withhold'} and ${got.image ? 'send' : 'withhold'}`]
    })

    expect(measured).toHaveLength(400)
    expect(wrong).toEqual([])
  })

  it('keeps each client\'s settings to itself', async () => {
    const [only, nothing, also] = await observe([[['Only']], [], [['Also'], ['Never', 'CCD1']]])

    expect([only, nothing, also]).toEqual([
      { others: false, image: true },
      { others: true, image: false },
      { others: true, image: false },
    ])
  })
})

describe('muting and refusing', () => {
  it('a muted device sends nothing and answers no getProperties until unmuted; other devices go on', async () => {
    const client = await connect()

    fake.mute('Mount')
    fake.update('Mount', 'TELESCOPE_PARK', { state: 'Busy' })
    client.send('<getProperties version="1.7" device="Mount"/>')
    client.send('<getProperties version="1.7" device="CCD"/>')
    await client.until('the other device', text => text.includes('defBLOBVector'))

    expect(client.text()).not.toContain('TELESCOPE_PARK')

    fake.unmute('Mount')
    client.send('<getProperties version="1.7" device="Mount"/>')
    await client.until('the device again', text => text.includes('state="Busy"'))
  })

  it('closes a new connection at once while refusing, and accepts again after', async () => {
    fake.refusingConnections = true
    const refused = net.connect(fake.port, '127.0.0.1')

    sockets.push(refused)
    await new Promise(resolve => refused.once('close', resolve))

    fake.refusingConnections = false
    const client = await connect()

    client.send('<getProperties version="1.7" device="Mount"/>')
    await client.until('an answer', text => text.includes('TELESCOPE_PARK'))
  })
})

describe('what a client writes', () => {
  it('reaches the behaviour with the connection that wrote it, and is entity-decoded', async () => {
    const seen: Array<[number, Record<string, string>]> = []

    fake.define({ device: 'Mount', name: 'NOTE', kind: 'text', perm: 'rw', state: 'Idle', elements: { TEXT: { value: '' } } })
    fake.behaviour = (_, __, values, client) => {
      seen.push([client.id, values])

      return 'handled'
    }
    const [first, second] = [await connect(), await connect()]

    second.send('<newTextVector device="Mount" name="NOTE"><oneText name="TEXT">a &amp; b</oneText></newTextVector>')
    await second.until('nothing', () => seen.length > 0)

    expect(first.text()).toBe('')
    expect(seen).toEqual([[2, { TEXT: 'a & b' }]])
  })

  it('received keeps only the last receivedLimit elements', async () => {
    const client = await connect()

    for (const index of [1, 2, 3, 4, 5]) client.send(`<getProperties version="1.${index}" device="none"/>`)
    await client.until('the fifth', () => fake.received.length === 3 && fake.received[2]!.includes('1.5'))

    expect(fake.received.map(xml => /version="([^"]+)"/.exec(xml)![1])).toEqual(['1.3', '1.4', '1.5'])
  })
})

describe('a client that never finishes an element', () => {
  it('is cut off once it has sent a megabyte of it', async () => {
    const client = await connect()

    client.socket.write(`<newTextVector device="Mount" name="NOTE"><oneText name="TEXT">${'x'.repeat(1024 * 1024 + 1)}`)
    await new Promise<void>(resolve => client.socket.once('close', () => resolve()))
  })
})

describe('removing', () => {
  it('removeVector deletes one property and tells the clients', async () => {
    const client = await connect()

    client.send('<getProperties version="1.7" device="Mount"/>')
    await pause(50)
    fake.removeVector('Mount', 'TELESCOPE_PARK')
    await client.until('delProperty', text => text.includes('<delProperty device="Mount" name="TELESCOPE_PARK"/>'))

    expect(fake.vectors.has('Mount.TELESCOPE_PARK')).toBe(false)
  })
})

/** Waits until everything the fake wrote to these clients before now has arrived: a ping is answered after earlier writes to the same socket. */
async function settle(...clients: Client[]): Promise<void> {
  const uid = `settle-${Math.random().toString(36).slice(2)}`

  await Promise.all(
    clients.map(async client => {
      client.send(`<pingRequest uid="${uid}"/>`)
      await client.until('the ping', text => text.includes(`<pingReply uid="${uid}"/>`))
    }),
  )
}

const taken = new WeakMap<Client, number>()

/** What the fake sent this client since the last call, without the pings `settle` used. */
function news(client: Client): string {
  const text = client.text()
  const from = taken.get(client) ?? 0

  taken.set(client, text.length)

  return text.slice(from).replace(/<pingReply uid="[^"]*"\/>\n?/g, '')
}

const defined = (client: Client, name: string) => client.text().split(`<defSwitchVector device="Mount" name="${name}"`).length - 1

describe('who hears what, as indiserver 2.2.5 delivers it (measured: indi-replay/measure/measure-definitions.py)', () => {
  beforeEach(() => {
    fake.define({ device: 'Mount', name: 'TELESCOPE_HOME', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { GO: { value: false } } })
  })

  it('a client that has not asked for a device hears nothing about it', async () => {
    const [silent, watching] = [await connect(), await connect()]

    watching.send('<getProperties version="1.7" device="Mount"/>')
    await settle(silent, watching)
    fake.update('Mount', 'TELESCOPE_PARK', { state: 'Busy' })
    fake.define({ device: 'Mount', name: 'NOTE', kind: 'text', perm: 'rw', state: 'Idle', elements: { TEXT: { value: '' } } })
    fake.removeVector('Mount', 'TELESCOPE_HOME')
    await settle(silent, watching)

    const heard = news(watching)

    expect(news(silent)).toBe('')
    expect(heard).toContain('<setSwitchVector device="Mount" name="TELESCOPE_PARK" state="Busy">')
    expect(heard).toContain('<defTextVector device="Mount" name="NOTE"')
    expect(heard).toContain('<delProperty device="Mount" name="TELESCOPE_HOME"/>')
  })

  it('an answer reaches every client that watches the device, not only the one that asked', async () => {
    const [asker, other, elsewhere] = [await connect(), await connect(), await connect()]

    asker.send('<getProperties version="1.7" device="Mount"/>')
    other.send('<getProperties version="1.7" device="Mount"/>')
    elsewhere.send('<getProperties version="1.7" device="CCD"/>')
    await settle(asker, other, elsewhere)
    asker.send('<getProperties version="1.7" device="Mount"/>')
    await settle(asker, other, elsewhere)

    expect([defined(asker, 'TELESCOPE_PARK'), defined(other, 'TELESCOPE_PARK'), defined(elsewhere, 'TELESCOPE_PARK')]).toEqual([3, 2, 0])
  })

  it('a request for one property is answered once, to every client that watches it', async () => {
    const [asker, device, same, different] = [await connect(), await connect(), await connect(), await connect()]

    device.send('<getProperties version="1.7" device="Mount"/>')
    same.send('<getProperties version="1.7" device="Mount" name="TELESCOPE_PARK"/>')
    different.send('<getProperties version="1.7" device="Mount" name="TELESCOPE_HOME"/>')
    await settle(asker, device, same, different)
    const before = [device, same, different].map(client => defined(client, 'TELESCOPE_PARK'))

    asker.send('<getProperties version="1.7" device="Mount" name="TELESCOPE_PARK"/>')
    await settle(asker, device, same, different)

    expect([defined(asker, 'TELESCOPE_PARK'), ...[device, same, different].map((client, index) => defined(client, 'TELESCOPE_PARK') - before[index]!)]).toEqual([1, 1, 1, 0])
  })

  it('a client watching one property hears that property and not the rest of the device', async () => {
    const [one, device] = [await connect(), await connect()]

    one.send('<getProperties version="1.7" device="Mount" name="TELESCOPE_PARK"/>')
    await settle(one)
    device.send('<getProperties version="1.7" device="Mount"/>')
    await settle(one, device)
    fake.update('Mount', 'TELESCOPE_HOME', { state: 'Busy' })
    fake.update('Mount', 'TELESCOPE_PARK', { state: 'Busy' })
    await settle(one, device)

    expect(one.text()).toContain('name="TELESCOPE_PARK"')
    expect(one.text()).not.toContain('TELESCOPE_HOME')
    expect(device.text()).toContain('<setSwitchVector device="Mount" name="TELESCOPE_HOME"')
  })

  it('asking for everything covers every device, ones defined later too', async () => {
    const all = await connect()

    all.send('<getProperties version="1.7"/>')
    await settle(all)
    fake.define({ device: 'Dome', name: 'DOME_SHUTTER', kind: 'switch', perm: 'rw', state: 'Idle', elements: { OPEN: { value: false } } })
    await settle(all)

    expect(all.text()).toContain('device="Mount" name="TELESCOPE_PARK"')
    expect(all.text()).toContain('device="CCD" name="CCD1"')
    expect(all.text()).toContain('<defSwitchVector device="Dome" name="DOME_SHUTTER"')
  })

  it('enableBLOB subscribes like a getProperties, but is not answered', async () => {
    const [device, property, nobody] = [await connect(), await connect(), await connect()]

    device.send('<enableBLOB device="CCD">Also</enableBLOB>')
    property.send('<enableBLOB device="CCD" name="CCD1">Also</enableBLOB>')
    await settle(device, property, nobody)

    expect([news(device), news(property)]).toEqual(['', ''])
    nobody.send('<getProperties version="1.7" device="CCD"/>')
    await settle(device, property, nobody)

    expect([device, property, nobody].map(client => client.text().includes('<defBLOBVector device="CCD" name="CCD1"'))).toEqual([true, true, true])
  })

  it('a request for something that does not exist is answered by nobody', async () => {
    const [asker, watching] = [await connect(), await connect()]

    watching.send('<getProperties version="1.7" device="Mount"/>')
    await settle(watching)
    asker.send('<getProperties version="1.7" device="Nothing"/><getProperties version="1.7" device="Mount" name="NOTHING"/>')
    await settle(asker, watching)
    expect([news(asker), defined(watching, 'TELESCOPE_PARK')]).toEqual(['', 1])
  })
})

describe('numbers a driver changes at runtime', () => {
  beforeEach(() => {
    fake.define({
      device: 'Focuser',
      name: 'ABS_FOCUS_POSITION',
      kind: 'number',
      perm: 'rw',
      state: 'Ok',
      elements: { FOCUS_ABSOLUTE_POSITION: { value: 50000, min: 0, max: 100000, step: 1000, format: '%.f' } },
    })
    fake.define({ device: 'Focuser', name: 'FOCUS_MAX', kind: 'number', perm: 'rw', state: 'Ok', elements: { FOCUS_MAX_VALUE: { value: 100000, min: 1000, max: 1000000, step: 10000, format: '%.f' } } })
  })

  it('an update carries min, max and step on the elements whose limits changed, to every client that watches', async () => {
    const [first, second] = [await connect(), await connect()]

    for (const client of [first, second]) client.send('<getProperties version="1.7" device="Focuser"/>')
    await settle(first, second)
    fake.update('Focuser', 'ABS_FOCUS_POSITION', { limits: { FOCUS_ABSOLUTE_POSITION: { max: 50000, step: 500 } } })
    fake.update('Focuser', 'FOCUS_MAX', { values: { FOCUS_MAX_VALUE: 50000 } })
    await settle(first, second)

    for (const client of [first, second]) {
      expect(client.text()).toContain('<setNumberVector device="Focuser" name="ABS_FOCUS_POSITION" state="Ok">\n  <oneNumber name="FOCUS_ABSOLUTE_POSITION" max="50000" step="500">50000</oneNumber>')
      expect(client.text()).toContain('<setNumberVector device="Focuser" name="FOCUS_MAX" state="Ok">\n  <oneNumber name="FOCUS_MAX_VALUE">50000</oneNumber>')
    }
  })

  it('a client that asks afterwards is defined the new limits', async () => {
    const late = await connect()

    fake.update('Focuser', 'ABS_FOCUS_POSITION', { limits: { FOCUS_ABSOLUTE_POSITION: { min: 100, max: 50000 } } })
    late.send('<getProperties version="1.7" device="Focuser" name="ABS_FOCUS_POSITION"/>')
    await settle(late)

    expect(late.text()).toContain('<defNumber name="FOCUS_ABSOLUTE_POSITION" label="FOCUS_ABSOLUTE_POSITION" format="%.f" min="100" max="50000" step="1000">50000</defNumber>')
  })

  it('a definition sent again replaces the old one, format included, for every client that watches', async () => {
    const watching = await connect()

    watching.send('<getProperties version="1.7" device="Focuser"/>')
    await settle(watching)
    fake.define({ device: 'Focuser', name: 'FOCUS_MAX', kind: 'number', perm: 'rw', state: 'Ok', elements: { FOCUS_MAX_VALUE: { value: 80000, min: 1000, max: 200000, step: 500, format: '%6.0f' } } })
    await settle(watching)

    expect(watching.text().split('<defNumberVector device="Focuser" name="FOCUS_MAX"')[2]).toContain('format="%6.0f" min="1000" max="200000" step="500">80000')
  })
})

describe('properties a driver defines more than once', () => {
  it('a device-wide request is answered with each property once, then again with the repeated ones; a named request once', async () => {
    fake.define({ device: 'Sim', name: 'ACTIVE_DEVICES', kind: 'text', perm: 'rw', state: 'Idle', repeats: 2, elements: { ACTIVE_TELESCOPE: { value: '' } } })
    fake.define({ device: 'Sim', name: 'DEBUG', kind: 'switch', perm: 'rw', state: 'Idle', elements: { ENABLE: { value: false } } })
    fake.define({ device: 'Sim', name: 'SIM_TILT', kind: 'number', perm: 'rw', state: 'Idle', repeats: 2, elements: { TILT: { value: 0 } } })
    const [asker, watching] = [await connect(), await connect()]

    watching.send('<getProperties version="1.7" device="Sim"/>')
    await settle(watching)
    news(watching)
    const order = () => [...news(watching).matchAll(/<def\w+Vector device="Sim" name="(\w+)"/g)].map(match => match[1])

    asker.send('<getProperties version="1.7" device="Sim"/>')
    await settle(asker, watching)

    expect(order()).toEqual(['ACTIVE_DEVICES', 'DEBUG', 'SIM_TILT', 'ACTIVE_DEVICES', 'SIM_TILT'])

    asker.send('<getProperties version="1.7" device="Sim" name="ACTIVE_DEVICES"/>')
    await settle(asker, watching)

    expect(order()).toEqual(['ACTIVE_DEVICES'])
  })
})
