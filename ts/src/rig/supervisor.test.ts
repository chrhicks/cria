import { execFileSync } from 'node:child_process'
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, connection } from '../../testing/fake-indi/index.ts'
import { startIndiServer, type RunningIndiServer } from '../../testing/indiserver.ts'
import { until } from '../../testing/until.ts'
import type { Property } from '../indi/index.ts'
import { parseConfig, settings } from './config.ts'
import { writeFifo } from './fifo.ts'
import { usbAttached } from './hardware.ts'
import { indiFacts, openIndiLink, type IndiLink } from './indi-link.ts'
import { createRig } from './supervisor.ts'

const site = { LAT: 33.45, LONG: 247.93, ELEV: 331 }

describe('settings', () => {
  it('describes every setting', () => {
    expect(Object.values(settings).every(setting => typeof setting.description === 'string' && setting.description.length > 10)).toBe(true)
  })

  it('reads USB presence from sysfs by vendor and product', () => {
    const sysfs = mkdtempSync(join(tmpdir(), 'sysfs-'))

    mkdirSync(join(sysfs, '1-2'))
    writeFileSync(join(sysfs, '1-2', 'idVendor'), '03c3\n')
    writeFileSync(join(sysfs, '1-2', 'idProduct'), '260A\n')
    mkdirSync(join(sysfs, '1-2:1.0'))

    expect([usbAttached('03c3:260a', sysfs), usbAttached('03c3:2209', sysfs), usbAttached('03c3:260a', join(sysfs, 'none'))]).toEqual([true, false, false])
  })
})

describe('what the rig program reads from a device in INDI', () => {
  const property = (name: string, state: string, elements: ReadonlyArray<[string, object]> = []) => ({ name, state, elements: new Map(elements) }) as unknown as Property
  const connect = (on: boolean): [string, object] => ['CONNECT', { kind: 'switch', on }]

  it('reads connected, disconnected and changing from CONNECTION, lists Busy properties, and keeps the values', () => {
    const facts = indiFacts([
      property('CONNECTION', 'Ok', [connect(true)]),
      property('CCD_EXPOSURE', 'Busy', [['CCD_EXPOSURE_VALUE', { kind: 'number', value: 2.5 }]]),
      property('DEVICE_PORT', 'Ok', [['PORT', { kind: 'text', value: '/dev/x' }]]),
      property('CCD1', 'Idle', [['CCD1', { kind: 'blob' }]]),
    ])

    expect(facts?.connection).toBe('connected')
    expect(facts?.busy).toEqual(['CCD_EXPOSURE'])
    expect(facts?.properties.get('CCD_EXPOSURE')).toEqual({ state: 'Busy', values: { CCD_EXPOSURE_VALUE: 2.5 } })
    expect(facts?.properties.get('DEVICE_PORT')?.values).toEqual({ PORT: '/dev/x' })
    expect(facts?.properties.get('CCD1')?.values).toEqual({})
    expect(indiFacts([property('CONNECTION', 'Idle', [connect(false)])])?.connection).toBe('disconnected')
    expect(indiFacts([property('CONNECTION', 'Busy', [connect(true)])])?.connection).toBe('changing')
    expect(indiFacts([])).toBeUndefined()
  })

  it('carries the error run it is given', () => {
    expect(indiFacts([property('CONNECTION', 'Ok', [connect(true)])], { since: 1, last: 2 })?.errorRun).toEqual({ since: 1, last: 2 })
  })
})

describe('the INDI link against a real indiserver', () => {
  it('sees a defined, disconnected simulator, writes its connection, and nothing for a device indiserver does not have', async () => {
    const server = await startIndiServer(['indi_simulator_focus'])
    const link = await openIndiLink({ host: '127.0.0.1', port: server.port, devices: ['Focuser Simulator', 'No Such Device'], errorGapMs: 5000, now: Date.now, warn: () => {} })

    try {
      const seen = await until('the simulator', async () => {
        const snapshot = await link.view()

        return snapshot.devices.has('Focuser Simulator') ? snapshot : undefined
      })

      expect([seen.linked, seen.devices.get('Focuser Simulator')?.connection, seen.devices.has('No Such Device')]).toEqual([true, 'disconnected', false])

      await link.write('Focuser Simulator', 'CONNECTION', { CONNECT: true })
      await until('the simulator to connect', async () => (await link.view()).devices.get('Focuser Simulator')?.connection === 'connected')
    } finally {
      await link.close()
      await server.stop()
    }
  })

  it('refuses to write a property the device does not define', async () => {
    const server = await startIndiServer(['indi_simulator_focus'])
    const link = await openIndiLink({ host: '127.0.0.1', port: server.port, devices: ['Focuser Simulator'], errorGapMs: 5000, now: Date.now, warn: () => {} })

    try {
      await until('the simulator', async () => (await link.view()).devices.has('Focuser Simulator'))
      await expect(link.write('Focuser Simulator', 'NO_SUCH_PROPERTY', { X: true })).rejects.toThrow('no property NO_SUCH_PROPERTY')
    } finally {
      await link.close()
      await server.stop()
    }
  })
})

describe('the rig program against a real indiserver', () => {
  const fifoPath = () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rig-fifo-')), 'indi.fifo')

    execFileSync('mkfifo', [path])

    return path
  }
  let server: RunningIndiServer | undefined
  let link: IndiLink | undefined

  afterEach(async () => {
    await link?.close()
    await server?.stop()
    server = undefined
    link = undefined
  })

  it('connects a device, and restarts its driver through the real FIFO when the driver dies, then connects it again', async () => {
    const fifo = fifoPath()

    server = await startIndiServer(['indi_simulator_focus', 'indi_simulator_gps'], { fifo })
    const config = parseConfig({
      fifo,
      indiPort: server.port,
      settlePolls: 1,
      minRestartGapMs: 1,
      fifoGapMs: 200,
      backoffMs: [100],
      devices: [
        { id: 'focuser', indiDevice: 'Focuser Simulator', serial: '/dev/null', driver: 'indi_simulator_focus', connected: true },
        { id: 'gps', indiDevice: 'GPS Simulator', serial: '/dev/null', driver: 'indi_simulator_gps', connected: false },
      ],
    })
    const logs: string[] = []

    link = await openIndiLink({ host: '127.0.0.1', port: server.port, devices: ['Focuser Simulator', 'GPS Simulator'], errorGapMs: config.errorGapMs, now: Date.now, warn: () => {} })
    const rig = createRig({ config, now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), hardwarePresent: () => true, writeFifo, indi: link, log: line => logs.push(line) })
    const connection = async () => (await link!.view()).devices.get('Focuser Simulator')?.connection
    const tickUntil = (what: string, probe: () => Promise<boolean>) =>
      until(what, async () => {
        await rig.tick()

        return (await probe()) || undefined
      })
    const driverPid = () => execFileSync('pgrep', ['-P', String(server!.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number)[0]!

    await tickUntil('the simulator to be connected', async () => (await connection()) === 'connected')

    const before = driverPid()

    process.kill(before, 'SIGKILL')
    await until('the device to disappear', async () => (await link!.view()).devices.has('Focuser Simulator') === false)
    await tickUntil('the restarted driver to be connected again', async () => (await connection()) === 'connected' && driverPid() !== before)

    expect(logs.some(line => line.includes('rig: indi_simulator_focus: restarting (focuser missing from INDI with hardware present; restart 1)'))).toBe(true)
    expect(logs.filter(line => line.includes('focuser: writing CONNECTION')).length).toBeGreaterThanOrEqual(2)
    expect(logs.some(line => line.includes('indi_simulator_gps'))).toBe(false)
  })

  it('starts every driver itself, and connects the device, when indiserver was started with none', async () => {
    const fifo = fifoPath()

    server = await startIndiServer([], { fifo })
    const config = parseConfig({
      fifo,
      indiPort: server.port,
      settlePolls: 1,
      fifoGapMs: 100,
      devices: [{ id: 'focuser', indiDevice: 'Focuser Simulator', serial: '/dev/null', driver: 'indi_simulator_focus', connected: true }],
    })

    link = await openIndiLink({ host: '127.0.0.1', port: server.port, devices: ['Focuser Simulator'], errorGapMs: config.errorGapMs, now: Date.now, warn: () => {} })
    const rig = createRig({ config, now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), hardwarePresent: () => true, writeFifo, indi: link, log: () => {} })

    await until('the simulator to be started and connected', async () => {
      await rig.tick()

      return (await link!.view()).devices.get('Focuser Simulator')?.connection === 'connected' || undefined
    })
  })
})

describe('the rig program against a fake INDI server', () => {
  let fake: FakeIndi | undefined
  let link: IndiLink | undefined

  afterEach(async () => {
    await link?.close()
    await fake?.stop()
    fake = undefined
    link = undefined
  })

  const clock = { at: 1_000_000 }

  async function start(devices: ReadonlyArray<object>, overrides: Record<string, unknown> = {}) {
    clock.at = 1_000_000
    fake = fake ?? new FakeIndi()
    const config = parseConfig({ fifo: '/run/test/indi.fifo', indiPort: fake.port, settlePolls: 1, ...overrides, devices })
    const logs: string[] = []
    const fifo: string[] = []

    link = await openIndiLink({ host: '127.0.0.1', port: fake.port, devices: config.devices.map(device => device.indiDevice), errorGapMs: config.errorGapMs, now: () => clock.at, warn: line => logs.push(line) })
    const rig = createRig({
      config,
      now: () => clock.at,
      sleep: async ms => {
        clock.at += ms
      },
      hardwarePresent: () => true,
      writeFifo: async (_path, line) => void fifo.push(line),
      indi: link,
      log: line => logs.push(line),
    })
    const settle = () => new Promise(resolve => setTimeout(resolve, 120))
    const tick = async (count = 1) => {
      for (let i = 0; i < count; i += 1) {
        await rig.tick()
        await settle()
        clock.at += 5_000
      }
    }

    await until('the devices', async () => {
      const snapshot = await link!.view()

      return config.devices.every(device => snapshot.devices.has(device.indiDevice)) || undefined
    })

    return { fake: fake!, logs, fifo, tick }
  }

  const writes = (property: string) => fake!.received.filter(xml => xml.startsWith('<new') && xml.includes(`name="${property}"`))

  it('connects a camera and switches it to upload frames to the client, then leaves it alone', async () => {
    fake = new FakeIndi()
    await fake.start()
    fake.define(connection('Fake CCD'))
    fake.define({ device: 'Fake CCD', name: 'UPLOAD_MODE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { UPLOAD_CLIENT: { value: false }, UPLOAD_LOCAL: { value: true }, UPLOAD_BOTH: { value: false } } })
    fake.update('Fake CCD', 'CONNECTION', { values: { CONNECT: false, DISCONNECT: true } })
    const { tick } = await start([{ id: 'primary', indiDevice: 'Fake CCD', usb: '03c3:260a', driver: 'indi_fake_ccd', connected: true, properties: { UPLOAD_MODE: { UPLOAD_CLIENT: true } } }])

    await tick(6)

    expect(fake.vector('Fake CCD', 'CONNECTION').elements.CONNECT!.value).toBe(true)
    expect(fake.vector('Fake CCD', 'UPLOAD_MODE').elements.UPLOAD_CLIENT!.value).toBe(true)
    expect(writes('CONNECTION')).toHaveLength(1)
    expect(writes('UPLOAD_MODE')).toHaveLength(1)
  })

  it('sets the serial port, then connects, then waits for the site and time the driver defines only after connecting, and sets each once', async () => {
    fake = new FakeIndi()
    await fake.start()
    fake.define(connection('ZWO AM5', false))
    fake.define({ device: 'ZWO AM5', name: 'DEVICE_PORT', kind: 'text', perm: 'rw', state: 'Ok', elements: { PORT: { value: '/dev/ttyUSB0' } } })
    const { tick, logs } = await start([
      { id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/am5', driver: 'indi_lx200am5', connected: true, properties: { GEOGRAPHIC_COORD: site }, onConnect: { TIME_UTC: { UTC: 'now', OFFSET: '0.00' } } },
    ])

    await tick(4)
    expect(fake.vector('ZWO AM5', 'CONNECTION').elements.CONNECT!.value).toBe(true)
    expect(fake.vector('ZWO AM5', 'DEVICE_PORT').elements.PORT!.value).toBe('/dev/serial/by-id/am5')
    expect(fake.received.filter(xml => /name="(DEVICE_PORT|CONNECTION)"/.test(xml) && xml.startsWith('<new')).map(xml => (xml.includes('DEVICE_PORT') ? 'port' : 'connection'))).toEqual(['port', 'connection'])
    expect(writes('GEOGRAPHIC_COORD')).toEqual([])

    fake.define({ device: 'ZWO AM5', name: 'GEOGRAPHIC_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { LAT: { value: 0, min: -90, max: 90 }, LONG: { value: 0, max: 360 }, ELEV: { value: 0, min: -200, max: 10000 } } })
    fake.define({ device: 'ZWO AM5', name: 'TIME_UTC', kind: 'text', perm: 'rw', state: 'Ok', elements: { UTC: { value: '2000-01-01T00:56:31' }, OFFSET: { value: '0.00' } } })
    await settleDefinitions()
    await tick(5)

    expect(fake.vector('ZWO AM5', 'GEOGRAPHIC_COORD').elements.LONG!.value).toBe(247.93)
    expect(writes('GEOGRAPHIC_COORD')).toHaveLength(1)
    expect(writes('TIME_UTC')).toHaveLength(1)
    expect(String(fake.vector('ZWO AM5', 'TIME_UTC').elements.UTC!.value)).toMatch(/^1970-01-01T00:1\d:\d\d$/)
    expect(logs.join('\n')).not.toMatch(/33\.45|247\.93|331/)
  })

  it('logs the INDI problems the driver sends', async () => {
    fake = new FakeIndi()
    await fake.start()
    fake.define(connection('ZWO AM5'))
    const { tick, logs } = await start([{ id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/am5', driver: 'indi_lx200am5', connected: true }])

    fake.raw('<setNumberVector device="ZWO AM5" name="GEOGRAPHIC_COORD"><oneNumber name="LAT">1x</oneNumber></setNumberVector>\n')
    await until('the problem to be logged', async () => (logs.some(line => line.includes('INDI protocol error #1: skipped the element')) ? true : undefined))
    await tick(1)

    expect(logs.filter(line => line.includes('INDI protocol error'))).toHaveLength(1)
  })

  async function settleDefinitions() {
    await until('the definitions to reach the rig program', async () => (await link!.view()).devices.get('ZWO AM5')?.properties.has('TIME_UTC') || undefined)
  }

  it('reconnects a device whose driver keeps reporting errors, and restarts the driver if that does not end them', async () => {
    fake = new FakeIndi()
    await fake.start()
    fake.define(connection('ZWO AM5'))
    fake.behaviour = vector => (vector.name === 'CONNECTION' ? 'handled' : 'default')
    const { tick, fifo, logs } = await start([{ id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/am5', driver: 'indi_lx200am5', connected: true }])

    await tick(2)

    const errors = async (seconds: number) => {
      for (let i = 0; i < seconds; i += 1) {
        clock.at += 1_000
        fake!.message('ZWO AM5', '[ERROR] Serial write error: Write Error: Input/output error.')
        await until('the error to arrive', async () => ((await link!.view()).devices.get('ZWO AM5')?.errorRun?.last === clock.at ? true : undefined))
      }
    }

    await errors(40)
    await tick(1)
    expect(writes('CONNECTION')).toHaveLength(1)
    expect(writes('CONNECTION')[0]).toContain('DISCONNECT')
    expect(logs.some(line => /dead link: the driver has reported errors for \d+ s; reconnecting/.test(line))).toBe(true)
    expect(fifo).toEqual([])

    await errors(61)
    await tick(1)
    expect(fifo).toEqual(['stop indi_lx200am5', 'start indi_lx200am5'])
    expect(logs.some(line => line.includes('rig: indi_lx200am5: restarting (mount still failing 60 s after a reconnect; restart 1)'))).toBe(true)
  })
})

describe('the rig program when a send fails', () => {
  it('sends the time again on a later poll, then leaves it alone', async () => {
    const config = parseConfig({
      fifo: '/x',
      devices: [{ id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/am5', driver: 'indi_lx200am5', connected: true, onConnect: { TIME_UTC: { UTC: 'now', OFFSET: '0.00' } } }],
    })
    const property = (name: string, elements: ReadonlyArray<[string, object]>) => ({ name, state: 'Ok', elements: new Map(elements) }) as unknown as Property
    const facts = indiFacts([
      property('CONNECTION', [['CONNECT', { kind: 'switch', on: true }]]),
      property('DEVICE_PORT', [['PORT', { kind: 'text', value: '/dev/serial/by-id/am5' }]]),
      property('TIME_UTC', [['UTC', { kind: 'text', value: '2000-01-01T00:00:00' }]]),
    ])!
    const sent: string[] = []
    let failures = 1
    let at = 0
    const rig = createRig({
      config,
      now: () => at,
      sleep: async () => {},
      hardwarePresent: () => true,
      writeFifo: async () => {},
      indi: {
        view: async () => ({ linked: true, devices: new Map([['ZWO AM5', facts]]) }),
        write: async (_device, name) => {
          sent.push(name)
          if (failures-- > 0) throw new Error('socket closed')
        },
      },
      log: () => {},
    })

    for (let poll = 0; poll < 12; poll += 1) {
      await rig.tick()
      at += 5_000
    }

    expect(sent).toEqual(['TIME_UTC', 'TIME_UTC'])
  })
})

describe('the FIFO', () => {
  const fifoPath = () => {
    const directory = mkdtempSync(join(tmpdir(), 'fifo-'))
    const path = join(directory, 'indi.fifo')

    execFileSync('mkfifo', [path])

    return path
  }

  it('delivers one command per line to a reader, as indiserver reads it', async () => {
    const path = fifoPath()
    const reader = new Socket({ fd: openSync(path, constants.O_RDONLY | constants.O_NONBLOCK), readable: true, writable: false })
    const holder = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK)
    let received = ''

    reader.setEncoding('utf8').on('data', chunk => (received += chunk))
    await writeFifo(path, 'stop indi_asi_ccd')
    await writeFifo(path, 'start indi_asi_ccd')
    await new Promise<void>(resolve => setTimeout(resolve, 100))
    reader.destroy()
    closeSync(holder)

    expect(received).toBe('stop indi_asi_ccd\nstart indi_asi_ccd\n')
  })

  it('fails at once, instead of hanging, when nothing reads the FIFO or it does not exist', async () => {
    await expect(writeFifo(fifoPath(), 'stop indi_asi_ccd')).rejects.toMatchObject({ code: 'ENXIO' })
    await expect(writeFifo(join(tmpdir(), 'no-such-fifo'), 'stop x')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('the FIFO', () => {
  it('spaces every line, across drivers too, so indiserver has reopened it', async () => {
    const config = parseConfig({
      fifo: '/run/test/indi.fifo',
      settlePolls: 1,
      devices: [
        { id: 'focuser', indiDevice: 'ZWO EAF', usb: '03c3:1f10', driver: 'indi_asi_focuser', connected: true },
        { id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/mount', driver: 'indi_lx200am5', connected: true },
      ],
    })
    const clock = { at: 1_000_000 }
    const lines: Array<{ readonly line: string; readonly at: number }> = []
    const rig = createRig({
      config,
      now: () => clock.at,
      sleep: async ms => {
        clock.at += ms
      },
      hardwarePresent: () => true,
      writeFifo: async (_path, line) => void lines.push({ line, at: clock.at }),
      indi: { view: async () => ({ linked: true, devices: new Map() }), write: async () => {} },
      log: () => {},
    })

    for (let poll = 0; poll < 3 && lines.length === 0; poll += 1) {
      await rig.tick()
      clock.at += config.pollMs
    }

    expect(lines.map(entry => entry.line)).toEqual(['stop indi_asi_focuser', 'start indi_asi_focuser', 'stop indi_lx200am5', 'start indi_lx200am5'])
    for (let index = 1; index < lines.length; index += 1) expect(lines[index]!.at - lines[index - 1]!.at).toBeGreaterThanOrEqual(config.fifoGapMs)
  })
})
