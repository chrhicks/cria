import { execFileSync } from 'node:child_process'
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script, not part of a TypeScript project
import { createSupervisor, indiFacts, openIndiView, parseConfig, settings, usbAttached, writeFifo } from '../deploy/rig-supervisor.mjs'
import { startIndiServer } from './indiserver.js'

const devices = [
  { id: 'primary', indiDevice: 'ZWO CCD 2600', usb: '03c3:260a', driver: 'indi_asi_ccd' },
  { id: 'guide', indiDevice: 'ZWO CCD 220', usb: '03c3:2209', driver: 'indi_asi_ccd' },
  { id: 'focuser', indiDevice: 'ZWO EAF', usb: '03c3:1f10', driver: 'indi_asi_focuser' },
  { id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/mount' },
  { id: 'box', indiDevice: 'Pegasus PPBA', serial: '/dev/serial/by-id/box' },
]

const indiName = (id: string) => devices.find(device => device.id === id)!.indiDevice

type Connection = 'connected' | 'disconnected' | 'changing'

class FakeIndi {
  linked = true
  devices = new Map<string, { connection: Connection; busy: string[] }>()

  constructor() {
    for (const device of devices) this.devices.set(device.indiDevice, { connection: 'connected', busy: [] })
  }

  set(id: string, connection: Connection, busy: string[] = []) {
    this.devices.set(indiName(id), { connection, busy })
  }

  missing(id: string) {
    this.devices.delete(indiName(id))
  }

  view() {
    return Promise.resolve({ linked: this.linked, devices: new Map(this.devices) })
  }
}

class FakeCria {
  instanceId = '11111111-1111-4111-8111-111111111111'
  reachable = true
  health: () => unknown = () => ({ status: 'ok', protocolVersion: 6, instanceId: this.instanceId })
  posts: Array<Record<string, unknown>> = []
  answer: { status: number; body: unknown } = { status: 200, body: { outcome: 'confirmed' } }
  connectDelayMs = 0
  server: Server = createServer((request, response) => void this.handle(request, response))
  url = ''

  async start() {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  stop() {
    this.server.closeAllConnections()

    return new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    if (!this.reachable) return void request.socket.destroy()
    if (request.method === 'GET' && request.url === '/health') return this.json(response, 200, this.health())
    if (request.method === 'POST' && request.url === '/connect') {
      const chunks: Buffer[] = []

      for await (const chunk of request) chunks.push(chunk as Buffer)
      this.posts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      await new Promise(resolve => setTimeout(resolve, this.connectDelayMs))

      return this.json(response, this.answer.status, this.answer.body)
    }

    return this.json(response, 404, {})
  }
}

function harness(overrides: Record<string, unknown> = {}) {
  const cria = new FakeCria()
  const indi = new FakeIndi()
  const clock = { at: 1_000_000 }
  const present = new Set<string>()
  const fifo: Array<{ line: string; at: number }> = []
  const logs: string[] = []

  const build = (writer?: (path: string, line: string) => Promise<void>) =>
    createSupervisor({
      config: parseConfig({ criaUrl: cria.url, fifo: '/run/test/indi.fifo', devices, ...overrides }),
      now: () => clock.at,
      sleep: async (ms: number) => {
        clock.at += ms
      },
      fetch,
      indi,
      hardwarePresent: (device: { id: string }) => present.has(device.id),
      writeFifo:
        writer ??
        (async (_path: string, line: string) => {
          fifo.push({ line, at: clock.at })
        }),
      log: (line: string) => logs.push(line),
    })

  const poll = async (supervisor: ReturnType<typeof build>, count = 1) => {
    for (let i = 0; i < count; i += 1) {
      await supervisor.tick()
      clock.at += 5_000
    }
  }

  return { cria, indi, clock, present, fifo, logs, build, poll }
}

let current: ReturnType<typeof harness>

beforeEach(async () => {
  current = harness()
  await current.cria.start()
})

afterEach(() => current.cria.stop())

const setUpEverything = async (supervisor: { tick: () => Promise<void> }) => {
  for (const device of devices) current.present.add(device.id)
  await current.poll(supervisor, 3)
  current.cria.posts = []
}

describe('config', () => {
  it('fills defaults and normalises', () => {
    const config = parseConfig({ devices: [{ id: 'a', indiDevice: 'Cam', usb: '03C3:260A', driver: 'indi_asi_ccd' }] }, { runtimeDir: '/run/user/1000' })

    expect(config).toEqual({
      criaUrl: 'http://127.0.0.1:4319',
      indiHost: '127.0.0.1',
      indiPort: 7624,
      fifo: '/run/user/1000/indi.fifo',
      pollMs: 5000,
      settlePolls: 2,
      stopGapMs: 1000,
      requestTimeoutMs: 5000,
      connectRequestTimeoutMs: 180_000,
      minRestartGapMs: 20_000,
      backoffMs: [10_000, 30_000, 60_000],
      devices: [{ id: 'a', indiDevice: 'Cam', usb: '03c3:260a', driver: 'indi_asi_ccd' }],
    })
  })

  it('describes every setting', () => {
    expect(Object.values(settings).every(setting => typeof (setting as { description: unknown }).description === 'string')).toBe(true)
  })

  it.each([
    [{ fifo: '/x', devices: [] }, 'devices must be a non-empty array'],
    [{ fifo: '/x', devices: [{ id: 'a', serial: '/dev/x' }] }, 'indiDevice is required'],
    [{ fifo: '/x', devices: [{ id: 'a', indiDevice: 'A' }] }, 'give exactly one of usb and serial'],
    [{ fifo: '/x', devices: [{ id: 'a', indiDevice: 'A', usb: '03c3:260a', serial: '/dev/x' }] }, 'give exactly one of usb and serial'],
    [{ fifo: '/x', devices: [{ id: 'a', indiDevice: 'A', serial: '/dev/x', driver: 'indi_x' }] }, 'driver only goes with usb'],
    [{ fifo: '/x', devices: [{ id: 'a', indiDevice: 'A', usb: 'nope' }] }, 'usb must look like'],
    [{ fifo: '/x', devices: [{ id: 'a', indiDevice: 'A', serial: '/dev/x' }, { id: 'a', indiDevice: 'B', serial: '/dev/y' }] }, 'listed twice'],
    [{ fifo: '/x', extra: 1, devices: [{ id: 'a', indiDevice: 'A', serial: '/dev/x' }] }, 'unknown key extra'],
    [{ fifo: '/x', backoffMs: [], devices: [{ id: 'a', indiDevice: 'A', serial: '/dev/x' }] }, 'backoffMs must be'],
    [{ devices: [{ id: 'a', indiDevice: 'A', serial: '/dev/x' }] }, 'fifo is required'],
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

describe('what the supervisor reads from a device in INDI', () => {
  const property = (name: string, state: string, on?: boolean) => ({
    name,
    state,
    elements: new Map(on === undefined ? [] : [['CONNECT', { kind: 'switch', on }]]),
  })

  it('reads connected, disconnected and changing from CONNECTION, and lists Busy properties', () => {
    expect([
      indiFacts([property('CONNECTION', 'Ok', true), property('CCD_EXPOSURE', 'Busy')]),
      indiFacts([property('CONNECTION', 'Idle', false)]),
      indiFacts([property('CONNECTION', 'Busy', true)]),
      indiFacts([]),
    ]).toEqual([
      { connection: 'connected', busy: ['CCD_EXPOSURE'] },
      { connection: 'disconnected', busy: [] },
      { connection: 'changing', busy: ['CONNECTION'] },
      undefined,
    ])
  })
})

describe('the INDI view against a real indiserver', () => {
  it('sees a defined, disconnected simulator, and nothing for a device indiserver does not have', async () => {
    const server = await startIndiServer(['indi_simulator_focus'])
    const view = await openIndiView({ host: '127.0.0.1', port: server.port, devices: ['Focuser Simulator', 'No Such Device'] })

    try {
      let seen = await view.view()

      for (let i = 0; i < 100 && !seen.devices.has('Focuser Simulator'); i += 1) {
        await new Promise(resolve => setTimeout(resolve, 50))
        seen = await view.view()
      }

      expect([seen.linked, seen.devices.get('Focuser Simulator')?.connection, seen.devices.has('No Such Device')]).toEqual([true, 'disconnected', false])
    } finally {
      await view.close()
      await server.stop()
    }
  })
})

describe('rule a: a missing device whose hardware is present gets its driver restarted', () => {
  it('restarts only that driver, stop then start, once the picture has held for two polls', async () => {
    const { indi, present, fifo, poll, build } = current

    indi.missing('primary')
    present.add('primary')
    const supervisor = build()

    await poll(supervisor, 1)
    expect(fifo).toEqual([])

    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
    expect(fifo[1]!.at - fifo[0]!.at).toBe(1000)
  })

  it('does nothing while the hardware is absent, and starts counting when it appears', async () => {
    const { indi, present, fifo, poll, build } = current

    indi.missing('primary')
    const supervisor = build()

    await poll(supervisor, 5)
    expect(fifo).toEqual([])

    present.add('primary')
    await poll(supervisor, 1)
    expect(fifo).toEqual([])
    await poll(supervisor, 1)
    expect(fifo).toHaveLength(2)
  })

  it('does nothing for a device whose config has no driver', async () => {
    const { indi, present, fifo, poll, build } = current

    indi.missing('mount')
    present.add('mount')
    await poll(build(), 5)

    expect(fifo).toEqual([])
  })

  it('does nothing when indiserver is unreachable or no configured device is defined', async () => {
    const { indi, present, fifo, poll, build } = current

    indi.linked = false
    present.add('primary')
    const supervisor = build()

    await poll(supervisor, 5)
    indi.linked = true
    indi.devices.clear()
    await poll(supervisor, 5)

    expect(fifo).toEqual([])
  })

  it("waits while any property on a device that driver serves is Busy, such as another client's guide exposure", async () => {
    const { indi, present, fifo, logs, poll, build } = current

    indi.missing('primary')
    indi.set('guide', 'connected', ['CCD_EXPOSURE'])
    present.add('primary')
    const supervisor = build()

    await poll(supervisor, 20)
    expect(fifo).toEqual([])
    expect(logs.filter(line => line.includes('guide CCD_EXPOSURE is Busy; not restarting'))).toHaveLength(1)

    indi.set('guide', 'connected')
    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
  })

  it('backs off 20 s (the restart floor), 30 s, then 60 s, and resets once the device is defined', async () => {
    const { indi, present, fifo, poll, build } = current

    indi.missing('primary')
    present.add('primary')
    const supervisor = build()

    await poll(supervisor, 60)

    const starts = fifo.filter(entry => entry.line.startsWith('start')).map(entry => entry.at)
    const gaps = starts.slice(1).map((at, index) => (at - starts[index]!) / 1000)

    expect(gaps.slice(0, 5).map(gap => Math.floor(gap / 5) * 5)).toEqual([20, 30, 60, 60, 60])

    indi.set('primary', 'connected')
    await poll(supervisor, 3)
    const before = fifo.length

    indi.missing('primary')
    await poll(supervisor, 3)
    expect(fifo.length).toBe(before + 2)
  })

  it('never restarts one driver more than once in 20 s even when polls are faster', async () => {
    const { indi, clock, present, fifo, build } = current

    indi.missing('primary')
    present.add('primary')
    const supervisor = build()

    for (let i = 0; i < 40; i += 1) {
      await supervisor.tick()
      clock.at += 1_000
    }
    const starts = fifo.filter(entry => entry.line.startsWith('start')).map(entry => entry.at)

    expect(starts.length).toBeGreaterThan(0)
    expect(starts.slice(1).every((at, index) => at - starts[index]! >= 20_000)).toBe(true)
  })

  it('restarts two drivers independently', async () => {
    const { indi, present, fifo, poll, build } = current

    indi.missing('primary')
    indi.missing('focuser')
    present.add('primary')
    present.add('focuser')
    await poll(build(), 2)

    expect(fifo.map(entry => entry.line).sort()).toEqual(['start indi_asi_ccd', 'start indi_asi_focuser', 'stop indi_asi_ccd', 'stop indi_asi_focuser'])
  })

  it('a failed FIFO write is logged and counts as a restart for the backoff', async () => {
    const { indi, present, logs, poll, build } = current

    indi.missing('primary')
    present.add('primary')
    const supervisor = build(async () => {
      throw Object.assign(new Error('ENXIO'), { code: 'ENXIO' })
    })

    await poll(supervisor, 4)

    expect(logs.filter(line => line.includes('FIFO write failed'))).toHaveLength(1)
  })
})

describe('rule b: a device that is disconnected, or not set up in this Cria instance, gets one device-connect', () => {
  it('posts device-connect and stops once Cria answers confirmed', async () => {
    const { cria, indi, present, poll, build } = current

    indi.set('mount', 'disconnected')
    present.add('mount')
    const supervisor = build()

    await poll(supervisor, 2)
    expect(cria.posts.filter(post => post.deviceId === 'mount')).toEqual([
      { deviceId: 'mount', connected: true },
    ])

    indi.set('mount', 'connected')
    await poll(supervisor, 20)
    expect(cria.posts.filter(post => post.deviceId === 'mount')).toHaveLength(1)
  })

  it('sets up a device that is connected but was never set up in this instance, and leaves it alone after', async () => {
    const { cria, present, poll, build } = current

    present.add('focuser')
    const supervisor = build()

    await poll(supervisor, 2)
    await poll(supervisor, 20)

    expect(cria.posts.filter(post => post.deviceId === 'focuser')).toHaveLength(1)
  })

  it('sets every device up again after Cria restarts', async () => {
    const { cria, poll, build } = current
    const supervisor = build()

    await setUpEverything(supervisor)
    await poll(supervisor, 5)
    expect(cria.posts).toEqual([])

    cria.instanceId = '22222222-2222-4222-8222-222222222222'
    await poll(supervisor, 1)

    expect(cria.posts.map(post => post.deviceId)).toEqual(devices.map(device => device.id))
  })

  it('sets a device up again after it disconnects and reconnects, or vanishes and returns', async () => {
    const { cria, indi, poll, build } = current
    const supervisor = build()

    await setUpEverything(supervisor)
    indi.set('focuser', 'disconnected')
    await poll(supervisor, 1)
    indi.set('focuser', 'connected')
    await poll(supervisor, 5)
    expect(cria.posts.map(post => post.deviceId)).toEqual(['focuser'])

    cria.posts = []
    indi.missing('mount')
    await poll(supervisor, 1)
    indi.set('mount', 'connected')
    await poll(supervisor, 1)
    expect(cria.posts.map(post => post.deviceId)).toEqual(['mount'])
  })

  it('retries after 10 s, then 30 s, then 60 s at most, when the outcome is not confirmed', async () => {
    const { cria, clock, indi, present, build } = current

    cria.answer = { status: 200, body: { outcome: 'uncertain' } }
    indi.set('mount', 'disconnected')
    present.add('mount')
    const supervisor = build()
    const sentAt: number[] = []

    for (let i = 0; i < 80; i += 1) {
      const before = cria.posts.length

      await supervisor.tick()
      if (cria.posts.length > before) sentAt.push(clock.at)
      clock.at += 5_000
    }
    const gaps = sentAt.slice(1).map((at, index) => (at - sentAt[index]!) / 1000)

    expect(gaps.slice(0, 5).map(gap => Math.floor(gap / 5) * 5)).toEqual([10, 30, 60, 60, 60])
  })

  it('backs off after a failed outcome and logs its message', async () => {
    const { cria, indi, present, logs, poll, build } = current

    cria.answer = { status: 200, body: { outcome: 'failed', message: 'setup: TIME_UTC: bad' } }
    indi.set('mount', 'disconnected')
    present.add('mount')
    await poll(build(), 4)

    expect(cria.posts).toHaveLength(2)
    expect(logs.some(line => line.includes('device-connect failed (setup: TIME_UTC: bad)'))).toBe(true)
  })

  it('backs off after an HTTP error such as an unknown device', async () => {
    const { cria, indi, present, logs, poll, build } = current

    cria.answer = { status: 404, body: { message: 'No device mount' } }
    indi.set('mount', 'disconnected')
    present.add('mount')
    await poll(build(), 4)

    expect(cria.posts).toHaveLength(2)
    expect(logs.some(line => line.includes('device-connect HTTP 404'))).toBe(true)
  })

  it('waits for a slow answer for longer than an ordinary request may take', async () => {
    const slow = harness({ requestTimeoutMs: 100, connectRequestTimeoutMs: 5000 })

    await slow.cria.start()
    try {
      slow.cria.connectDelayMs = 300
      slow.indi.set('mount', 'disconnected')
      slow.present.add('mount')
      const supervisor = slow.build()

      await slow.poll(supervisor, 2)
      slow.indi.set('mount', 'connected')
      await slow.poll(supervisor, 10)

      expect(slow.cria.posts).toHaveLength(1)
      expect(slow.logs.some(line => line.includes('mount: set up'))).toBe(true)
    } finally {
      await slow.cria.stop()
    }
  })

  it('waits for hardware, and while CONNECTION is changing', async () => {
    const { cria, indi, present, poll, build } = current

    indi.set('mount', 'disconnected')
    indi.set('focuser', 'changing', ['CONNECTION'])
    present.add('focuser')
    const supervisor = build()

    await poll(supervisor, 5)
    expect(cria.posts).toEqual([])

    present.add('mount')
    await poll(supervisor, 2)
    expect(cria.posts.map(post => post.deviceId)).toEqual(['mount'])
  })

})

describe('guards', () => {
  it('does nothing, and sends nothing, while Cria is unreachable; the picture must hold again afterwards', async () => {
    const { cria, indi, present, fifo, logs, poll, build } = current

    indi.missing('primary')
    indi.set('mount', 'disconnected')
    present.add('primary')
    present.add('mount')
    cria.reachable = false
    const supervisor = build()

    await poll(supervisor, 10)
    expect([fifo, cria.posts]).toEqual([[], []])
    expect(logs.filter(line => line.includes('Cria unreachable'))).toHaveLength(1)

    cria.reachable = true
    await poll(supervisor, 1)
    expect([fifo, cria.posts]).toEqual([[], []])
    expect(logs.some(line => line.includes('Cria reachable again'))).toBe(true)

    await poll(supervisor, 1)
    expect(fifo.map(entry => entry.line)).toEqual(['stop indi_asi_ccd', 'start indi_asi_ccd'])
    expect(cria.posts.map(post => post.deviceId)).toContain('mount')
  })

  it('treats a health answer without an instance as Cria being unreachable', async () => {
    const { cria, indi, present, fifo, poll, build } = current

    cria.health = () => ({ status: 'ok', protocolVersion: 6 })
    indi.missing('primary')
    present.add('primary')
    await poll(build(), 5)

    expect(fifo).toEqual([])
  })

  it('logs a steady wait once, not every poll', async () => {
    const { indi, present, logs, poll, build } = current

    indi.missing('primary')
    indi.set('guide', 'connected', ['CCD_EXPOSURE'])
    present.add('primary')
    await poll(build(), 20)

    expect(logs.filter(line => line.includes('not restarting'))).toHaveLength(1)
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
