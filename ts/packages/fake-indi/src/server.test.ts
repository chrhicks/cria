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
      '<setBLOBVector device="CCD" name="CCD1" state="Ok">\n  <oneBLOB name="CCD1" size="6" format=".fits">\ncGl4ZWxz\n  </oneBLOB>\n</setBLOBVector>\n',
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

    client.send('<enableBLOB device="CCD">Also</enableBLOB>')
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
      '<setBLOBVector device="CCD" name="CCD1" state="Ok">\n  <oneBLOB name="CCD1" size="6" format=".fits">\ncGl4ZWxz\n  </oneBLOB>\n</setBLOBVector>\n',
    )
    expect(also.text()).toContain('<setSwitchVector device="Mount" name="TELESCOPE_PARK" state="Busy">')
    expect(also.text()).toContain('<defTextVector device="Mount" name="MOUNT_INFO"')
    expect(also.text()).toContain('<delProperty device="Mount" name="TIME_LST"/>')
  })
})

/**
 * Each row is what indiserver 2.2.5 delivered, measured with indi_simulator_ccd (the script and its
 * output are in the description of PR #10). `others` is every definition, update and deletion;
 * `image` is the image of the property the row names, CCD1. Only a device-wide `Only` withholds
 * `others`, and a property's setting wins over the device's for `image`.
 */
const enableBlobRows: ReadonlyArray<readonly [string, ReadonlyArray<readonly [BlobMode, string?]>, boolean, boolean]> = [
  ['nothing sent', [], true, false],
  ['device Never', [['Never']], true, false],
  ['device Also', [['Also']], true, true],
  ['device Only', [['Only']], false, true],
  ['CONNECTION Never', [['Never', 'CONNECTION']], true, false],
  ['CONNECTION Also', [['Also', 'CONNECTION']], true, false],
  ['CONNECTION Only', [['Only', 'CONNECTION']], true, false],
  ['CCD1 Never', [['Never', 'CCD1']], true, false],
  ['CCD1 Also', [['Also', 'CCD1']], true, true],
  ['CCD1 Only', [['Only', 'CCD1']], true, true],
  ['device Also, then CCD1 Never', [['Also'], ['Never', 'CCD1']], true, false],
  ['device Also, then CCD1 Only', [['Also'], ['Only', 'CCD1']], true, true],
  ['device Never, then CCD1 Also', [['Never'], ['Also', 'CCD1']], true, true],
  ['device Never, then CCD1 Only', [['Never'], ['Only', 'CCD1']], true, true],
  ['device Only, then CCD1 Also', [['Only'], ['Also', 'CCD1']], false, true],
  ['device Only, then CCD1 Never', [['Only'], ['Never', 'CCD1']], false, false],
]

describe('enableBLOB at device and property scope, as indiserver delivers it', () => {
  it.each(enableBlobRows)('%s', async (_title, settings, others, image) => {
    fake.define({ device: 'CCD', name: 'CONNECTION', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { CONNECT: { value: true }, DISCONNECT: { value: false } } })
    fake.define({ device: 'CCD', name: 'CCD_EXPOSURE', kind: 'number', perm: 'rw', state: 'Idle', elements: { CCD_EXPOSURE_VALUE: { value: 0 } } })
    const client = await connect()

    for (const [mode, name] of settings) client.send(`<enableBLOB device="CCD"${name ? ` name="${name}"` : ''}>${mode}</enableBLOB>`)
    client.send('<pingRequest uid="enabled"/>')
    await client.until('the settings', text => text.includes('<pingReply uid="enabled"/>'))
    client.send('<getProperties version="1.7" device="CCD"/>')
    client.send('<getProperties version="1.7" device="CCD" name="CCD1"/>')
    fake.update('CCD', 'CCD_EXPOSURE', { state: 'Busy' })
    fake.define({ device: 'CCD', name: 'CCD_TEMPERATURE', kind: 'number', perm: 'ro', state: 'Ok', elements: { CCD_TEMPERATURE_VALUE: { value: 1 } } })
    fake.removeVector('CCD', 'CCD_TEMPERATURE')
    await pause(50)
    expect(await fake.deliverBlob('CCD', 'CCD1', 'CCD1', Buffer.from('pixels'))).toBe(image ? 1 : 0)
    client.send('<pingRequest uid="done"/>')
    await client.until('the ping', text => text.includes('<pingReply uid="done"/>'))

    const received = client.text()

    expect({
      deviceDefinitions: received.includes('<defSwitchVector device="CCD" name="CONNECTION"'),
      propertyDefinition: received.includes('<defBLOBVector device="CCD" name="CCD1"'),
      update: received.includes('<setNumberVector device="CCD" name="CCD_EXPOSURE" state="Busy">'),
      broadcastDefinition: received.includes('<defNumberVector device="CCD" name="CCD_TEMPERATURE"'),
      deletion: received.includes('<delProperty device="CCD" name="CCD_TEMPERATURE"/>'),
      image: received.includes('<setBLOBVector device="CCD" name="CCD1"'),
    }).toEqual({ deviceDefinitions: others, propertyDefinition: others, update: others, broadcastDefinition: others, deletion: others, image })
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

    fake.removeVector('Mount', 'TELESCOPE_PARK')
    await client.until('delProperty', text => text.includes('<delProperty device="Mount" name="TELESCOPE_PARK"/>'))

    expect(fake.vectors.has('Mount.TELESCOPE_PARK')).toBe(false)
  })
})
