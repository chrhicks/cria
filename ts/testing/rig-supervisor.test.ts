import { execFileSync } from 'node:child_process'
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script with JSDoc types, not part of a TypeScript project
import { backoffMs, createSupervisor, minRestartGapMs, parseConfig, usbAttached, writeFifo } from '../deploy/rig-supervisor.mjs'

const devices = [
  { id: 'primary', usb: '03c3:260a', driver: 'indi_asi_ccd' },
  { id: 'guide', usb: '03c3:2209', driver: 'indi_asi_ccd' },
  { id: 'focuser', usb: '03c3:1f10', driver: 'indi_asi_focuser' },
  { id: 'mount', serial: '/dev/serial/by-id/mount' },
  { id: 'weather', serial: '/dev/serial/by-id/weather' },
]

type Reason = 'unavailable' | 'disconnected' | 'starting' | 'busy' | 'blocked' | undefined

interface FakeDevice {
  reason: Reason
  held?: boolean
  readings?: Record<string, unknown>
}

const names: Record<string, string> = { primary: 'ZWO CCD 2600', guide: 'ZWO CCD 220', focuser: 'ZWO EAF', mount: 'ZWO AM5', weather: 'Pegasus PPBA', switch: 'Pegasus PPBA' }
const domains: Record<string, string> = { switch: 'Pegasus_PPBA', weather: 'Pegasus_PPBA' }

/** A fake Cria: serves a mutable /v2/state over real HTTP and records every POST. */
class FakeCria {
  commandsEnabled = true
  reachable = true
  devices: Record<string, FakeDevice> = {}
  operations: Array<{ deviceId: string; failureDomain: string; state: 'running' | 'settled'; kind: string }> = []
  posts: Array<Record<string, unknown>> = []
  answer: { status: number; body: unknown } = { status: 202, body: {} }
  server: Server = createServer((request, response) => void this.handle(request, response))
  url = ''

  constructor() {
    for (const id of Object.keys(names)) this.devices[id] = { reason: undefined }
  }

  async start() {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  stop() {
    this.server.closeAllConnections()

    return new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  state() {
    return {
      protocolVersion: 5,
      instanceId: '11111111-1111-4111-8111-111111111111',
      sequence: 1,
      generatedAt: 0,
      commandsEnabled: this.commandsEnabled,
      operations: this.operations,
      devices: Object.entries(this.devices).map(([id, device]) => ({
        id,
        kind: 'camera',
        name: names[id],
        bindingId: `binding-${id}`,
        failureDomain: domains[id] ?? id,
        availability: device.reason ? { ready: false, reason: device.reason, message: device.reason } : { ready: true },
        quarantine: device.held ? { held: true, reason: 'test', since: 0 } : { held: false },
        afterOperation: null,
        readings: device.readings ?? {},
      })),
    }
  }

  private async handle(request: IncomingMessage, response: import('node:http').ServerResponse) {
    if (!this.reachable) return void request.socket.destroy()
    if (request.method === 'GET' && request.url === '/v2/state') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(this.state()))

      return
    }
    if (request.method === 'POST' && request.url === '/v2/operations') {
      const chunks: Buffer[] = []

      for await (const chunk of request) chunks.push(chunk as Buffer)
      this.posts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      response.writeHead(this.answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(this.answer.body))

      return
    }
    response.writeHead(404).end('{}')
  }
}

function harness(overrides: { settlePolls?: number } = {}) {
  const cria = new FakeCria()
  const clock = { at: 1_000_000 }
  const present = new Set<string>()
  const fifo: Array<{ line: string; at: number }> = []
  const logs: string[] = []
  let counter = 0

  const build = () =>
    createSupervisor({
      config: parseConfig({ criaUrl: cria.url, fifo: '/run/test/indi.fifo', devices, ...overrides }),
      now: () => clock.at,
      sleep: async (ms: number) => {
        clock.at += ms
      },
      fetch,
      hardwarePresent: (device: { id: string }) => present.has(device.id),
      writeFifo: async (_path: string, line: string) => {
        fifo.push({ line, at: clock.at })
      },
      log: (line: string) => logs.push(line),
      uuid: () => `uuid-${++counter}`,
    })

  /** Runs `count` polls, 5 s apart, returning after the last. */
  const poll = async (supervisor: ReturnType<typeof build>, count = 1) => {
    for (let i = 0; i < count; i += 1) {
      await supervisor.tick()
      clock.at += 5_000
    }
  }

  return { cria, clock, present, fifo, logs, build, poll }
}

let current: ReturnType<typeof harness>

beforeEach(async () => {
  current = harness()
  await current.cria.start()
})

afterEach(() => current.cria.stop())

const commandsOnly = (posts: Array<Record<string, unknown>>) => expect(posts.every(post => post.kind === 'device-connect' && JSON.stringify(post.parameters) === '{"connected":true}')).toBe(true)

describe('config', () => {
  it('fills defaults and normalises', () => {
    const config = parseConfig({ devices: [{ id: 'a', usb: '03C3:260A', driver: 'indi_asi_ccd' }] }, { runtimeDir: '/run/user/1000' })

    expect(config).toEqual({
      criaUrl: 'http://127.0.0.1:4319',
      fifo: '/run/user/1000/indi.fifo',
      pollMs: 5000,
      settlePolls: 2,
      stopGapMs: 1000,
      requestTimeoutMs: 5000,
      devices: [{ id: 'a', usb: '03c3:260a', driver: 'indi_asi_ccd' }],
    })
  })

  it.each([
    [{ fifo: '/x', devices: [] }, 'devices must be a non-empty array'],
    [{ fifo: '/x', devices: [{ id: 'a' }] }, 'give exactly one of usb and serial'],
    [{ fifo: '/x', devices: [{ id: 'a', usb: '03c3:260a', serial: '/dev/x' }] }, 'give exactly one of usb and serial'],
    [{ fifo: '/x', devices: [{ id: 'a', serial: '/dev/x', driver: 'indi_x' }] }, 'driver only goes with usb'],
    [{ fifo: '/x', devices: [{ id: 'a', usb: 'nope' }] }, 'usb must look like'],
    [{ fifo: '/x', devices: [{ id: 'a', serial: '/dev/x' }, { id: 'a', serial: '/dev/y' }] }, 'listed twice'],
    [{ fifo: '/x', extra: 1, devices: [{ id: 'a', serial: '/dev/x' }] }, 'unknown key extra'],
    [{ devices: [{ id: 'a', serial: '/dev/x' }] }, 'fifo is required'],
  ])('refuses %j', (config, message) => {
    expect(() => parseConfig(config)).toThrow(message)
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

describe('rule a: a missing device whose hardware is present gets its driver restarted', () => {
  it('restarts only that driver, stop then start, once the picture has held for two polls', async () => {
    const { cria, present, fifo, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    const supervisor = build()

    await poll(supervisor, 1)
    expect(fifo).toEqual([])

    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
    expect(fifo[1]!.at - fifo[0]!.at).toBe(1000)
    expect(cria.posts).toEqual([])
  })

  it('does nothing while the hardware is absent, and starts counting when it appears', async () => {
    const { cria, present, fifo, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    const supervisor = build()

    await poll(supervisor, 6)
    expect(fifo).toEqual([])

    present.add('primary')
    await poll(supervisor, 1)
    expect(fifo).toEqual([])
    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
  })

  it('does nothing for a device whose config has no driver', async () => {
    const { cria, present, fifo, poll, build } = current

    cria.devices.mount!.reason = 'unavailable'
    present.add('mount')
    await poll(build(), 4)

    expect(fifo).toEqual([])
  })

  it('does nothing when every device is unavailable: indiserver is down, not one driver', async () => {
    const { cria, present, fifo, poll, build } = current

    for (const device of Object.values(cria.devices)) device.reason = 'unavailable'
    for (const id of ['primary', 'guide', 'focuser', 'mount', 'weather']) present.add(id)
    await poll(build(), 6)

    expect(fifo).toEqual([])
  })

  it.each([
    ['an operation open on the same driver’s other device', (c: FakeCria) => c.operations.push({ deviceId: 'guide', failureDomain: 'guide', state: 'running', kind: 'capture' })],
    ['an operation open on the missing device’s own domain', (c: FakeCria) => c.operations.push({ deviceId: 'primary', failureDomain: 'primary', state: 'running', kind: 'device-connect' })],
    ['a hold on the same driver’s other device', (c: FakeCria) => void (c.devices.guide!.held = true)],
    ['the same driver’s other camera exposing', (c: FakeCria) => void (c.devices.guide!.readings = { activity: { status: 'fresh', value: 'exposing' } })],
  ])('does not restart a driver with %s, and does once that clears', async (_name, block) => {
    const { cria, present, fifo, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    block(cria)
    const supervisor = build()

    await poll(supervisor, 5)
    expect(fifo).toEqual([])

    cria.operations.length = 0
    cria.devices.guide!.held = false
    cria.devices.guide!.readings = {}
    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
  })

  it('ignores a settled operation and one on another driver', async () => {
    const { cria, present, fifo, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    cria.operations.push({ deviceId: 'primary', failureDomain: 'primary', state: 'settled', kind: 'capture' }, { deviceId: 'focuser', failureDomain: 'focuser', state: 'running', kind: 'focuser-move' })
    await poll(build(), 2)

    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
  })

  it('does nothing while commands are disabled', async () => {
    const { cria, present, fifo, poll, build } = current

    cria.commandsEnabled = false
    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    await poll(build(), 5)

    expect(fifo).toEqual([])
  })

  it('backs off 20 s (the restart floor), 30 s, then 60 s, and resets once the device is defined', async () => {
    const { cria, present, fifo, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    const supervisor = build()

    await poll(supervisor, 60)

    const starts = fifo.filter(entry => entry.line.startsWith('start')).map(entry => entry.at)
    const gaps = starts.slice(1).map((at, index) => (at - starts[index]!) / 1000)

    // The fake clock also moves 1 s per restart (the pause between stop and start), so a gap lands up to one poll late.
    expect(gaps.slice(0, 5).map(gap => Math.floor(gap / 5) * 5)).toEqual([20, 30, 60, 60, 60])
    expect(backoffMs).toEqual([10_000, 30_000, 60_000])
    expect(minRestartGapMs).toBe(20_000)

    // The device shows up; the count resets, so the next outage waits only the 20 s floor.
    cria.devices.primary!.reason = undefined
    await poll(supervisor, 3)
    const before = fifo.length

    cria.devices.primary!.reason = 'unavailable'
    await poll(supervisor, 3)
    expect(fifo.length).toBe(before + 2)
  })

  it('never restarts one driver more than once in 20 s even when polls are faster', async () => {
    const { cria, clock, present, fifo, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    const supervisor = build()

    for (let i = 0; i < 40; i += 1) {
      await supervisor.tick()
      clock.at += 1_000
    }
    const starts = fifo.filter(entry => entry.line.startsWith('start')).map(entry => entry.at)

    expect(starts.slice(1).every((at, index) => at - starts[index]! >= 20_000)).toBe(true)
    expect(starts.length).toBeGreaterThan(0)
  })

  it('restarts two drivers independently', async () => {
    const { cria, present, fifo, poll, build } = current

    for (const id of ['primary', 'focuser']) {
      cria.devices[id]!.reason = 'unavailable'
      present.add(id)
    }
    await poll(build(), 2)

    expect(fifo.map(entry => entry.line).sort()).toEqual(['start indi_asi_ccd', 'start indi_asi_focuser', 'stop indi_asi_ccd', 'stop indi_asi_focuser'])
  })
})

describe('rule b: a defined, disconnected device whose hardware is present gets one device-connect', () => {
  it('posts a device-connect with the identity Cria reported', async () => {
    const { cria, present, poll, build } = current

    cria.devices.mount!.reason = 'disconnected'
    present.add('mount')
    const supervisor = build()

    await poll(supervisor, 1)
    expect(cria.posts).toEqual([])
    await poll(supervisor, 1)

    expect(cria.posts).toEqual([
      {
        instanceId: '11111111-1111-4111-8111-111111111111',
        requestId: 'supervisor-uuid-1',
        deviceId: 'mount',
        bindingId: 'binding-mount',
        expectedName: 'ZWO AM5',
        kind: 'device-connect',
        parameters: { connected: true },
      },
    ])
  })

  it('waits for hardware, and connects a USB device too', async () => {
    const { cria, present, poll, build } = current

    cria.devices.focuser!.reason = 'disconnected'
    const supervisor = build()

    await poll(supervisor, 4)
    expect(cria.posts).toEqual([])

    present.add('focuser')
    await poll(supervisor, 2)
    expect(cria.posts.map(post => post.deviceId)).toEqual(['focuser'])
  })

  it('retries after 10 s, then 30 s, then 60 s at most, each with a new request ID', async () => {
    const { cria, clock, present, poll, build } = current

    cria.devices.mount!.reason = 'disconnected'
    present.add('mount')
    const supervisor = build()
    const times: number[] = []
    let seen = 0

    for (let i = 0; i < 80; i += 1) {
      await supervisor.tick()
      if (cria.posts.length > seen) times.push(clock.at)
      seen = cria.posts.length
      clock.at += 5_000
    }
    const gaps = times.slice(1).map((at, index) => (at - times[index]!) / 1000)

    expect(gaps.slice(0, 5)).toEqual([10, 30, 60, 60, 60])
    expect(new Set(cria.posts.map(post => post.requestId)).size).toBe(cria.posts.length)
    expect(cria.posts.every(post => /^supervisor-uuid-\d+$/.test(String(post.requestId)))).toBe(true)
    commandsOnly(cria.posts)
  })

  it('does not resend while the operation it started is open, and resets once the device is connected', async () => {
    const { cria, present, poll, build } = current

    cria.devices.mount!.reason = 'disconnected'
    present.add('mount')
    const supervisor = build()

    await poll(supervisor, 2)
    expect(cria.posts).toHaveLength(1)

    cria.operations.push({ deviceId: 'mount', failureDomain: 'mount', state: 'running', kind: 'device-connect' })
    await poll(supervisor, 30)
    expect(cria.posts).toHaveLength(1)

    cria.operations.length = 0
    cria.devices.mount!.reason = undefined
    await poll(supervisor, 1)
    cria.devices.mount!.reason = 'disconnected'
    await poll(supervisor, 1)
    expect(cria.posts).toHaveLength(2)
    // attempts reset when it connected, so the wait is the 10 s step again, not 30 s
    await poll(supervisor, 2)
    expect(cria.posts).toHaveLength(3)
  })

  it('does nothing while another operation is open on the same INDI device (the Pegasus switch and weather share one)', async () => {
    const { cria, present, poll, build } = current

    cria.devices.weather!.reason = 'disconnected'
    present.add('weather')
    cria.operations.push({ deviceId: 'switch', failureDomain: 'Pegasus_PPBA', state: 'running', kind: 'switch-set' })
    const supervisor = build()

    await poll(supervisor, 5)
    expect(cria.posts).toEqual([])

    cria.operations.length = 0
    await poll(supervisor, 1)
    expect(cria.posts.map(post => post.deviceId)).toEqual(['weather'])
  })

  it('does nothing while commands are disabled', async () => {
    const { cria, present, poll, build } = current

    cria.commandsEnabled = false
    cria.devices.mount!.reason = 'disconnected'
    present.add('mount')
    await poll(build(), 6)

    expect(cria.posts).toEqual([])
  })

  it('does not connect a device that is held', async () => {
    const { cria, present, poll, build } = current

    cria.devices.mount!.reason = 'disconnected'
    cria.devices.mount!.held = true
    present.add('mount')
    await poll(build(), 6)

    expect(cria.posts).toEqual([])
  })

  it('goes quiet after a refusal that names a hold, until the hold clears', async () => {
    const { cria, present, logs, poll, build } = current

    cria.devices.mount!.reason = 'disconnected'
    present.add('mount')
    cria.answer = { status: 409, body: { error: { code: 'device-blocked', message: 'Blocked until recovered: x' }, instanceId: 'i' } }
    const supervisor = build()

    await poll(supervisor, 2)
    expect(cria.posts).toHaveLength(1)
    expect(logs.some(line => line.includes('refused device-blocked; waiting'))).toBe(true)

    // Cria still says held: stay quiet however long it takes.
    cria.devices.mount!.held = true
    await poll(supervisor, 40)
    expect(cria.posts).toHaveLength(1)

    cria.devices.mount!.held = false
    cria.answer = { status: 202, body: {} }
    await poll(supervisor, 1)
    expect(cria.posts).toHaveLength(2)
  })

  it('goes quiet after commands-disabled, and tries again once commands are enabled', async () => {
    const { cria, present, poll, build } = current

    cria.devices.mount!.reason = 'disconnected'
    present.add('mount')
    cria.answer = { status: 403, body: { error: { code: 'commands-disabled', message: 'x' }, instanceId: 'i' } }
    const supervisor = build()

    await poll(supervisor, 2)
    cria.commandsEnabled = false
    await poll(supervisor, 20)
    expect(cria.posts).toHaveLength(1)

    cria.commandsEnabled = true
    cria.answer = { status: 202, body: {} }
    await poll(supervisor, 1)
    expect(cria.posts).toHaveLength(2)
  })

  it('does not connect a device the driver has not defined, and leaves a ready device alone', async () => {
    const { cria, present, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    for (const id of Object.keys(cria.devices)) present.add(id)
    await poll(build(), 1)
    expect(cria.posts).toEqual([])
    expect(Object.values(cria.devices).filter(device => device.reason === undefined).length).toBeGreaterThan(0)
  })
})

describe('guards', () => {
  it('does nothing, and sends nothing, while Cria is unreachable; the picture must hold again afterwards', async () => {
    const { cria, present, fifo, logs, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    cria.devices.mount!.reason = 'disconnected'
    present.add('primary')
    present.add('mount')
    cria.reachable = false
    const supervisor = build()

    await poll(supervisor, 10)
    expect(fifo).toEqual([])
    expect(cria.posts).toEqual([])
    expect(logs.filter(line => line.includes('Cria unreachable'))).toHaveLength(1)

    cria.reachable = true
    await poll(supervisor, 1)
    expect(fifo).toEqual([])
    expect(cria.posts).toEqual([])
    expect(logs.some(line => line.includes('Cria reachable again'))).toBe(true)

    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
    expect(cria.posts).toHaveLength(1)
  })

  it('treats a response that is not a protocol 5 state as Cria being unreachable', async () => {
    const { cria, present, fifo, poll, build } = current
    const state = cria.state.bind(cria)

    cria.state = () => ({ ...state(), protocolVersion: 4 })
    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    await poll(build(), 5)

    expect(fifo).toEqual([])
  })

  it('logs a steady wait once, not every poll', async () => {
    const { cria, present, logs, poll, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    cria.operations.push({ deviceId: 'guide', failureDomain: 'guide', state: 'running', kind: 'capture' })
    await poll(build(), 20)

    expect(logs.filter(line => line.includes('not restarting'))).toHaveLength(1)
  })

  it('sends the bearer token when given one', async () => {
    const seen: Array<string | undefined> = []
    const probe = createServer((request, response) => {
      seen.push(request.headers.authorization)
      response.writeHead(200).end(JSON.stringify({ ...current.cria.state() }))
    })

    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const supervisor = createSupervisor({
      config: parseConfig({ criaUrl: `http://127.0.0.1:${(probe.address() as AddressInfo).port}`, fifo: '/x', devices }),
      now: () => 0,
      sleep: async () => {},
      fetch,
      hardwarePresent: () => false,
      writeFifo: async () => {},
      log: () => {},
      token: 'secret',
    })

    await supervisor.tick()
    probe.closeAllConnections()
    await new Promise<void>(resolve => probe.close(() => resolve()))

    expect(seen).toEqual(['Bearer secret'])
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
    let received = ''

    // indiserver holds its FIFO open for good; without a writer open, the reader sees EOF after the first command.
    const holder = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK)

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

  it('a failed write is logged and counts as a restart for the backoff', async () => {
    const { cria, clock, present, logs, build } = current

    cria.devices.primary!.reason = 'unavailable'
    present.add('primary')
    const supervisor = createSupervisor({
      config: parseConfig({ criaUrl: cria.url, fifo: '/run/test/indi.fifo', devices }),
      now: () => clock.at,
      sleep: async () => {},
      fetch,
      hardwarePresent: (device: { id: string }) => present.has(device.id),
      writeFifo: async () => {
        throw Object.assign(new Error('ENXIO'), { code: 'ENXIO' })
      },
      log: (line: string) => logs.push(line),
    })

    await supervisor.tick()
    await supervisor.tick()
    await supervisor.tick()

    expect(logs.filter(line => line.includes('FIFO write failed'))).toHaveLength(1)
  })
})
