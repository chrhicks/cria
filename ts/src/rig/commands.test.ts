import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, connection } from '../../testing/fake-indi/index.ts'
import { stream } from '../../testing/stream-settings.ts'
import { until } from '../../testing/until.ts'
import { createCommands, type CommandAnswer } from './commands.ts'
import { parseConfig } from './config.ts'
import { openIndiLink, type IndiLink } from './indi-link.ts'

const mount = 'Mount'
const camera = 'Camera'

let fake: FakeIndi
let link: IndiLink
let clock = 1_000_000

const config = () =>
  parseConfig(
    {
      fifo: '/tmp/none',
      stream,
      devices: [
        { id: 'mount', indiDevice: mount, serial: '/dev/null', driver: 'indi_mount', connected: true, properties: { TELESCOPE_TRACK_MODE: { TRACK_SIDEREAL: true } } },
        { id: 'camera', indiDevice: camera, usb: '03c3:260a', driver: 'indi_camera', connected: true, onConnect: { CCD_COOLER: { COOLER_ON: true } } },
      ],
    },
    {},
  )

beforeEach(async () => {
  clock = 1_000_000
  fake = new FakeIndi()
  await fake.start()
  fake.define(connection(mount))
  fake.define(connection(camera))
  fake.define({ device: mount, name: 'EQUATORIAL_EOD_COORD', kind: 'number', perm: 'rw', elements: { RA: { value: 0, min: 0, max: 24, step: 0 }, DEC: { value: 0, min: -90, max: 90, step: 0 } } })
  fake.define({ device: mount, name: 'TELESCOPE_TRACK_MODE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', elements: { TRACK_SIDEREAL: { value: true }, TRACK_LUNAR: { value: false } } })
  fake.define({ device: mount, name: 'TELESCOPE_PARK', kind: 'switch', perm: 'rw', rule: 'AtMostOne', elements: { PARK: { value: false }, UNPARK: { value: false } } })
  fake.define({ device: mount, name: 'TELESCOPE_ABORT_MOTION', kind: 'switch', perm: 'rw', rule: 'AtMostOne', elements: { ABORT: { value: false } } })
  fake.define({ device: mount, name: 'TELESCOPE_INFO', kind: 'number', perm: 'ro', elements: { TELESCOPE_APERTURE: { value: 80, min: 0, max: 0, step: 0 } } })
  fake.define({ device: mount, name: 'NOTE', kind: 'text', perm: 'rw', elements: { TEXT: { value: '' } } })
  fake.define({ device: camera, name: 'CCD_EXPOSURE', kind: 'number', perm: 'rw', elements: { CCD_EXPOSURE_VALUE: { value: 0, min: 0, max: 3600, step: 0 } } })
  fake.define({ device: camera, name: 'CCD_ABORT_EXPOSURE', kind: 'switch', perm: 'rw', rule: 'AtMostOne', elements: { ABORT: { value: false } } })
  fake.define({ device: camera, name: 'CCD_COOLER', kind: 'switch', perm: 'rw', rule: 'OneOfMany', elements: { COOLER_ON: { value: false }, COOLER_OFF: { value: true } } })
  link = await openIndiLink({ host: '127.0.0.1', port: fake.port, devices: [mount, camera], errorGapMs: 5_000, now: () => clock, warn: () => {} })
  await until('the mirror to hold both devices', () => link.property(camera, 'CCD_COOLER') && link.property(mount, 'NOTE'))
})

afterEach(async () => {
  link.close()
  await fake.stop()
})

function setup(indi: Pick<IndiLink, 'property' | 'write'> = link) {
  const answers: CommandAnswer[] = []
  const commands = createCommands({ config: config(), indi, answer: answer => answers.push(answer), log: () => {} })

  return { answers, commands }
}

let counter = 0

const send = (commands: ReturnType<typeof setup>['commands'], device: string, body: Record<string, unknown>) =>
  commands.receive(device, JSON.stringify({ id: `c${++counter}`, by: 'test', ...body }))

const sentNew = () => fake.received.filter(xml => /^<new(Number|Switch|Text)Vector/.test(xml))

describe('commands from the stream', () => {
  it('writes a command for a writable property and answers written', async () => {
    const { answers, commands } = setup()

    await send(commands, 'mount', { property: 'EQUATORIAL_EOD_COORD', values: { RA: 5.5, DEC: 12 } })

    expect(answers).toEqual([{ id: `c${counter}`, by: 'test', device: 'mount', property: 'EQUATORIAL_EOD_COORD', result: 'written' }])
    await until('the fake to receive the write', () => sentNew().length === 1)
    expect(sentNew()[0]).toContain('name="EQUATORIAL_EOD_COORD"')
    expect(sentNew()[0]).toContain('5.5')
  })

  it('refuses a device or property that is unknown', async () => {
    const { answers, commands } = setup()

    await send(commands, 'dome', { property: 'NOTE', values: { TEXT: 'x' } })
    await send(commands, 'mount', { property: 'NO_SUCH', values: { A: 1 } })

    expect(answers.map(answer => answer.reason)).toEqual(['dome is not in the rig file', 'mount has no property NO_SUCH'])
    expect(sentNew()).toHaveLength(0)
  })

  it('refuses a property the rig file owns, including CONNECTION and onConnect ones', async () => {
    const { answers, commands } = setup()

    await send(commands, 'mount', { property: 'TELESCOPE_TRACK_MODE', values: { TRACK_LUNAR: true } })
    await send(commands, 'mount', { property: 'CONNECTION', values: { DISCONNECT: true } })
    await send(commands, 'camera', { property: 'CCD_COOLER', values: { COOLER_OFF: true } })

    expect(answers.map(answer => answer.reason)).toEqual([
      'TELESCOPE_TRACK_MODE is kept by the rig file',
      'CONNECTION is kept by the rig file',
      'CCD_COOLER is kept by the rig file',
    ])
    expect(sentNew()).toHaveLength(0)
  })

  it('refuses what is not a command, answering with what it could read', async () => {
    const { answers, commands } = setup()

    await commands.receive('mount', '{"id":"half","by":"test"')
    await commands.receive('mount', JSON.stringify({ id: 'partial', by: 'test', property: 'NOTE' }))

    expect(answers).toEqual([
      { id: '', by: '', device: 'mount', property: '', result: 'refused', reason: 'not a command: it needs id, property, values and by' },
      { id: 'partial', by: 'test', device: 'mount', property: 'NOTE', result: 'refused', reason: 'not a command: it needs id, property, values and by' },
    ])
  })

  it('answers refused with the reason when INDI will not take the write, and answers the next command', async () => {
    const { answers, commands } = setup({ property: link.property, write: (device, property, values) => (property === 'NOTE' ? Promise.reject(new Error('INDI write failed: socket closed')) : link.write(device, property, values)) })

    await send(commands, 'mount', { property: 'NOTE', values: { TEXT: 'x' } })
    await send(commands, 'mount', { property: 'EQUATORIAL_EOD_COORD', values: { RA: 1, DEC: 1 } })

    expect(answers.map(answer => [answer.result, answer.reason])).toEqual([
      ['refused', 'INDI write failed: socket closed'],
      ['written', undefined],
    ])
  })
})
