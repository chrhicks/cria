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
  fake.define({ device: mount, name: 'TELESCOPE_SLEW_RATE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', elements: { '6x': { value: false }, '8x': { value: false }, '10x': { value: true } } })
  fake.define({ device: mount, name: 'TELESCOPE_MOTION_NS', kind: 'switch', perm: 'rw', rule: 'AtMostOne', elements: { MOTION_NORTH: { value: false }, MOTION_SOUTH: { value: false } } })
  fake.define({ device: mount, name: 'TELESCOPE_MOTION_WE', kind: 'switch', perm: 'rw', rule: 'AtMostOne', elements: { MOTION_WEST: { value: false }, MOTION_EAST: { value: false } } })
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

function fakeTimers() {
  const pending = new Map<number, { readonly ms: number; readonly run: () => void }>()
  let next = 0

  return {
    pending,
    schedule: (ms: number, run: () => void) => {
      const key = (next += 1)

      pending.set(key, { ms, run })

      return () => void pending.delete(key)
    },
    lapse: () => {
      for (const [key, timer] of [...pending]) {
        pending.delete(key)
        timer.run()
      }
    },
  }
}

function setup(indi: Pick<IndiLink, 'property' | 'write'> = link, timers = fakeTimers()) {
  const answers: CommandAnswer[] = []
  const logged: string[] = []
  const commands = createCommands({ config: config(), indi, answer: answer => answers.push(answer), log: line => void logged.push(line), schedule: timers.schedule })

  return { answers, commands, timers, logged }
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

const switches = (xml: string) => [...xml.matchAll(/<oneSwitch name="([^"]+)">\s*(On|Off)\s*<\/oneSwitch>/g)].map(match => `${match[1]} ${match[2]}`).join(', ')

const writes = () => sentNew().map(xml => `${/name="([A-Z_]+)"/.exec(xml.slice(xml.indexOf('name=')))?.[1] ?? '?'}: ${switches(xml)}`)

describe('nudges', () => {
  it('sets the slew rate, then moves toward the direction, answers written and starts the lease', async () => {
    const { answers, commands, timers } = setup()

    await send(commands, 'mount', { nudge: 'north', rate: '8x' })

    expect(answers).toEqual([{ id: `c${counter}`, by: 'test', device: 'mount', property: 'TELESCOPE_MOTION_NS', result: 'written' }])
    await until('both writes', () => sentNew().length === 2)
    expect(writes()).toEqual(['TELESCOPE_SLEW_RATE: 8x On', 'TELESCOPE_MOTION_NS: MOTION_NORTH On, MOTION_SOUTH Off'])
    expect([...timers.pending.values()].map(timer => timer.ms)).toEqual([1_000])
  })

  it('stops the motion when no word comes within the lease, and logs why', async () => {
    const { commands, timers, logged } = setup()

    await send(commands, 'mount', { nudge: 'east', rate: '6x' })
    timers.lapse()

    await until('the stop', () => sentNew().length === 3)
    expect(writes()[2]).toBe('TELESCOPE_MOTION_WE: MOTION_EAST Off, MOTION_WEST Off')
    await until('the log line', () => logged.some(line => line.includes('had no word for 1000 ms')))
  })

  it('keeps moving while the page holds, starting the lease again each time', async () => {
    const { commands, timers } = setup()

    await send(commands, 'mount', { nudge: 'south', rate: '8x' })
    const nudgeId = `c${counter}`

    await send(commands, 'mount', { hold: nudgeId })
    await send(commands, 'mount', { hold: nudgeId })

    expect(timers.pending.size).toBe(1)
    await until('the two starting writes', () => sentNew().length === 2)
    expect(sentNew()).toHaveLength(2)
  })

  it('stops at once on release and answers it; a release or hold for another nudge changes nothing', async () => {
    const { answers, commands, timers } = setup()

    await send(commands, 'mount', { nudge: 'west', rate: '8x' })
    const nudgeId = `c${counter}`

    await send(commands, 'mount', { hold: 'someone-else' })
    await send(commands, 'mount', { release: 'someone-else' })
    await until('the two starting writes', () => sentNew().length === 2)
    expect(sentNew()).toHaveLength(2)

    await send(commands, 'mount', { release: nudgeId })

    await until('the stop', () => sentNew().length === 3)
    expect(writes()[2]).toBe('TELESCOPE_MOTION_WE: MOTION_WEST Off, MOTION_EAST Off')
    expect(timers.pending.size).toBe(0)
    expect(answers.map(answer => [answer.property, answer.result])).toEqual([
      ['TELESCOPE_MOTION_WE', 'written'],
      ['', 'written'],
      ['TELESCOPE_MOTION_WE', 'written'],
    ])
  })

  it('stops the nudge it replaces before moving another way', async () => {
    const { commands, timers } = setup()

    await send(commands, 'mount', { nudge: 'north', rate: '8x' })
    await send(commands, 'mount', { nudge: 'east', rate: '8x' })

    await until('five writes', () => sentNew().length === 5)
    expect(writes().slice(2)).toEqual(['TELESCOPE_MOTION_NS: MOTION_NORTH Off, MOTION_SOUTH Off', 'TELESCOPE_SLEW_RATE: 8x On', 'TELESCOPE_MOTION_WE: MOTION_EAST On, MOTION_WEST Off'])
    expect(timers.pending.size).toBe(1)
  })

  it('refuses a rate the mount does not have, and a device with no motion, without moving anything', async () => {
    const { answers, commands, timers } = setup()

    await send(commands, 'mount', { nudge: 'north', rate: '99x' })
    await send(commands, 'camera', { nudge: 'north', rate: '8x' })

    expect(answers.map(answer => answer.reason)).toEqual(['TELESCOPE_SLEW_RATE has no rate 99x', 'camera has no property TELESCOPE_SLEW_RATE'])
    expect(sentNew()).toHaveLength(0)
    expect(timers.pending.size).toBe(0)
  })
})
