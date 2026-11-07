import { describe, expect, it } from 'vitest'
import { parseConfig, type RigConfig, type WantedValue } from './config.ts'
import type { DeviceFacts } from './indi-link.ts'
import { decide, emptyMemory, holds, type Action, type Memory } from './reconcile.ts'

const site = { LAT: 33.45, LONG: 247.93, ELEV: 331 }

const devices = [
  { id: 'primary', indiDevice: 'ZWO CCD 2600', usb: '03c3:260a', driver: 'indi_asi_ccd', connected: true, properties: { UPLOAD_MODE: { UPLOAD_CLIENT: true } } },
  { id: 'guide', indiDevice: 'ZWO CCD 220', usb: '03c3:2209', driver: 'indi_asi_ccd', connected: true, properties: { UPLOAD_MODE: { UPLOAD_CLIENT: true } } },
  { id: 'focuser', indiDevice: 'ZWO EAF', usb: '03c3:1f10', driver: 'indi_asi_focuser', connected: true },
  {
    id: 'mount',
    indiDevice: 'ZWO AM5',
    serial: '/dev/serial/by-id/mount',
    driver: 'indi_lx200am5',
    connected: true,
    properties: { GEOGRAPHIC_COORD: site },
    onConnect: { TIME_UTC: { UTC: 'now', OFFSET: '0.00' } },
  },
  { id: 'box', indiDevice: 'Pegasus PPBA', serial: '/dev/serial/by-id/box', driver: 'indi_pegasus_ppba', connected: true },
]

const makeConfig = (overrides: Record<string, unknown> = {}, list: ReadonlyArray<object> = devices) => parseConfig({ fifo: '/run/test/indi.fifo', devices: list, ...overrides })

type Values = Record<string, Record<string, WantedValue>>

interface Sim {
  connection: 'connected' | 'disconnected' | 'changing'
  properties: Values
  busy: string[]
  brokenSince?: number
}

const holdingProperties = (id: string): Values => {
  const wanted = devices.find(device => device.id === id)!

  return JSON.parse(JSON.stringify({ ...(wanted.serial ? { DEVICE_PORT: { PORT: wanted.serial } } : {}), ...('properties' in wanted ? wanted.properties : {}) })) as Values
}

const factsOf = (sim: Sim, now: number): DeviceFacts => {
  const properties = new Map([
    ['CONNECTION', { state: sim.connection === 'changing' ? 'Busy' : 'Ok', values: { CONNECT: sim.connection === 'connected', DISCONNECT: sim.connection === 'disconnected' } }],
    ...Object.entries(sim.properties).map(([name, values]) => [name, { state: sim.busy.includes(name) ? 'Busy' : 'Ok', values }] as const),
    ...sim.busy.filter(name => !(name in sim.properties)).map(name => [name, { state: 'Busy', values: {} }] as const),
  ])
  const erroring = sim.brokenSince !== undefined && sim.connection === 'connected'

  return {
    connection: sim.connection,
    busy: [...properties].filter(([, property]) => property.state === 'Busy').map(([name]) => name),
    properties: properties as DeviceFacts['properties'],
    ...(erroring ? { errorRun: { since: sim.brokenSince!, last: now - 300 } } : {}),
  }
}

class Bench {
  readonly config: RigConfig
  memory: Memory
  now = 1_000_000
  linked = true
  sims = new Map<string, Sim>()
  present = new Set<string>(devices.map(device => device.id))
  actions: Array<{ at: number; action: Action }> = []
  reconnectFixes = false

  constructor(overrides: Record<string, unknown> = {}, list: ReadonlyArray<object> = devices) {
    this.config = makeConfig(overrides, list)
    this.memory = emptyMemory(this.config)
    for (const device of this.config.devices) this.sims.set(device.id, { connection: 'connected', properties: holdingProperties(device.id), busy: [] })
  }

  sim(id: string): Sim {
    return this.sims.get(id)!
  }

  missing(id: string) {
    this.sims.delete(id)
  }

  poll(count = 1) {
    for (let i = 0; i < count; i += 1) {
      const snapshot = {
        linked: this.linked,
        devices: new Map(this.config.devices.flatMap(device => (this.sims.has(device.id) ? [[device.indiDevice, factsOf(this.sims.get(device.id)!, this.now)] as const] : []))),
      }
      const decision = decide(this.config, { now: this.now, snapshot, hardware: Object.fromEntries(this.config.devices.map(device => [device.id, this.present.has(device.id)])) }, this.memory)

      this.memory = decision.memory
      for (const action of decision.actions) {
        this.actions.push({ at: this.now, action })
        this.apply(action)
      }
      this.now += 5_000
    }
  }

  private apply(action: Action) {
    if (action.kind === 'write') {
      const sim = this.sims.get(action.device)!

      if (action.property === 'CONNECTION') {
        sim.connection = 'CONNECT' in action.values ? 'connected' : 'disconnected'
        if (sim.connection === 'connected') sim.properties = { ...this.definedOnConnect(action.device), ...sim.properties }
        if (this.reconnectFixes) delete sim.brokenSince
      } else sim.properties[action.property] = { ...sim.properties[action.property], ...action.values }
    }
    if (action.kind === 'restart-driver') {
      for (const device of this.config.devices.filter(candidate => candidate.driver === action.driver)) {
        this.sims.set(device.id, { connection: 'disconnected', properties: { DEVICE_PORT: { PORT: '/dev/ttyUSB0' } }, busy: [] })
      }
    }
  }

  private definedOnConnect(id: string): Values {
    const device = this.config.devices.find(candidate => candidate.id === id)!
    const unset = (wanted: Record<string, WantedValue>) => Object.fromEntries(Object.entries(wanted).map(([element, value]) => [element, typeof value === 'number' ? 0 : typeof value === 'boolean' ? false : '']))

    return Object.fromEntries([...Object.entries(device.properties), ...Object.entries(device.onConnect)].filter(([name]) => name !== 'DEVICE_PORT').map(([name, wanted]) => [name, unset(wanted)]))
  }

  writes(property?: string) {
    return this.actions.flatMap(({ at, action }) => (action.kind === 'write' && (property === undefined || action.property === property) ? [{ at, device: action.device, property: action.property, values: action.values }] : []))
  }

  restarts() {
    return this.actions.flatMap(({ at, action }) => (action.kind === 'restart-driver' ? [{ at, driver: action.driver }] : []))
  }

  logs() {
    return this.actions.flatMap(({ action }) => (action.kind === 'log' ? [action.line] : []))
  }
}

describe('the rig file', () => {
  it('fills defaults, normalises, and takes the serial device port from its path', () => {
    const config = parseConfig({ devices: [{ id: 'a', indiDevice: 'Cam', usb: '03C3:260A', driver: 'indi_asi_ccd', connected: true }, { id: 'm', indiDevice: 'Mount', serial: '/dev/x', connected: false }] }, { runtimeDir: '/run/user/1000' })

    expect(config).toEqual({
      indiHost: '127.0.0.1',
      indiPort: 7624,
      fifo: '/run/user/1000/indi.fifo',
      pollMs: 5000,
      settlePolls: 2,
      stopGapMs: 1000,
      minRestartGapMs: 20_000,
      deadLinkMs: 30_000,
      errorGapMs: 5000,
      reconnectWaitMs: 60_000,
      numberTolerance: 1e-6,
      backoffMs: [10_000, 30_000, 60_000],
      devices: [
        { id: 'a', indiDevice: 'Cam', usb: '03c3:260a', driver: 'indi_asi_ccd', connected: true, properties: {}, onConnect: {} },
        { id: 'm', indiDevice: 'Mount', serial: '/dev/x', connected: false, properties: { DEVICE_PORT: { PORT: '/dev/x' } }, onConnect: {} },
      ],
    })
  })

  const one = (device: object) => ({ fifo: '/x', devices: [{ id: 'a', indiDevice: 'A', serial: '/dev/x', connected: true, ...device }] })

  it.each([
    [{ fifo: '/x', devices: [] }, 'devices must be a non-empty array'],
    [{ fifo: '/x', devices: [{ id: 'a', serial: '/dev/x', connected: true }] }, 'indiDevice is required'],
    [one({ serial: undefined }), 'give exactly one of usb and serial'],
    [one({ usb: '03c3:260a' }), 'give exactly one of usb and serial'],
    [one({ serial: undefined, usb: 'nope' }), 'usb must look like'],
    [one({ driver: 'a b' }), 'driver must be an executable name'],
    [one({ connected: undefined }), 'connected must be true or false'],
    [one({ properties: { DEVICE_PORT: { PORT: '/dev/y' } } }), 'DEVICE_PORT comes from serial'],
    [one({ properties: { X: {} } }), 'must be an object of element values'],
    [one({ properties: { X: { Y: null } } }), 'must be a finite number, a boolean or a string'],
    [one({ onConnect: [] }), 'onConnect must be an object'],
    [{ fifo: '/x', devices: [one({}).devices[0], one({}).devices[0]] }, 'listed twice'],
    [{ ...one({}), extra: 1 }, 'unknown key extra'],
    [{ ...one({}), backoffMs: [] }, 'backoffMs must be'],
    [{ ...one({}), deadLinkMs: 0 }, 'deadLinkMs must be a positive integer'],
    [{ devices: one({}).devices }, 'fifo is required'],
  ])('refuses %j', (config, message) => {
    expect(() => parseConfig(config)).toThrow(message)
  })
})

describe('holds', () => {
  it('compares numbers within the tolerance and everything else exactly', () => {
    const found = { state: 'Ok' as const, values: { LAT: 33.4500004, MODE: 'x', ON: true } }

    expect([holds(found, { LAT: 33.45 }, 1e-6), holds(found, { LAT: 33.46 }, 1e-6), holds(found, { MODE: 'x', ON: true }, 0), holds(found, { MODE: 'y' }, 0), holds(found, { MISSING: 1 }, 1)]).toEqual([true, false, true, false, false])
  })
})

describe('connecting a device', () => {
  it('writes CONNECT once the hardware has been seen for two polls, then backs off 10 s, 30 s and 60 s while it does not take', () => {
    const bench = new Bench()

    bench.sim('focuser').connection = 'disconnected'
    const stuck = () => (bench.sim('focuser').connection = 'disconnected')

    for (let i = 0; i < 40; i += 1) {
      bench.poll()
      stuck()
    }

    const at = bench.writes('CONNECTION').map(write => (write.at - 1_000_000) / 1000)

    expect(bench.writes('CONNECTION').every(write => write.device === 'focuser' && 'CONNECT' in write.values)).toBe(true)
    expect(at.slice(0, 5)).toEqual([5, 15, 45, 105, 165])
  })

  it('writes nothing for a device whose hardware is absent, and says so once', () => {
    const bench = new Bench()

    bench.present.delete('focuser')
    bench.sim('focuser').connection = 'disconnected'
    bench.poll(10)

    expect(bench.writes()).toEqual([])
    expect(bench.logs().filter(line => line.includes('focuser: disconnected, hardware not present yet'))).toHaveLength(1)
  })

  it('leaves a device alone while its CONNECTION is changing', () => {
    const bench = new Bench()

    bench.sim('focuser').connection = 'changing'
    bench.poll(10)

    expect(bench.writes()).toEqual([])
  })

  it('writes the serial port before the connection, and the connection only once the port shows', () => {
    const bench = new Bench()
    const mount = bench.sim('mount')

    mount.connection = 'disconnected'
    mount.properties = { DEVICE_PORT: { PORT: '/dev/ttyUSB0' } }
    bench.poll(4)

    expect(bench.writes().filter(write => write.property === 'DEVICE_PORT' || write.property === 'CONNECTION').map(write => [write.property, write.at - 1_000_000])).toEqual([['DEVICE_PORT', 5_000], ['CONNECTION', 10_000]])
    expect(bench.sim('mount').properties.DEVICE_PORT).toEqual({ PORT: '/dev/serial/by-id/mount' })
  })

  it('does not connect while the port write keeps failing to take', () => {
    const bench = new Bench()

    bench.sim('mount').connection = 'disconnected'
    bench.sim('mount').properties = { DEVICE_PORT: { PORT: '/dev/ttyUSB0' } }
    for (let i = 0; i < 6; i += 1) {
      bench.poll()
      bench.sim('mount').properties = { DEVICE_PORT: { PORT: '/dev/ttyUSB0' } }
    }

    expect(bench.writes('CONNECTION')).toEqual([])
    expect(bench.writes('DEVICE_PORT').length).toBeGreaterThan(1)
  })

  it('disconnects a device the rig file wants disconnected', () => {
    const bench = new Bench({}, [{ id: 'focuser', indiDevice: 'ZWO EAF', usb: '03c3:1f10', driver: 'indi_asi_focuser', connected: false }])

    bench.sim('focuser').connection = 'connected'
    bench.poll(3)

    expect(bench.writes().map(write => [write.property, write.values])).toEqual([['CONNECTION', { DISCONNECT: true }]])
  })

  it('writes nothing while indiserver is unreachable or none of the devices is defined', () => {
    const bench = new Bench()

    bench.sim('focuser').connection = 'disconnected'
    bench.linked = false
    bench.poll(5)
    bench.linked = true
    const sims = bench.sims

    bench.sims = new Map()
    bench.poll(5)
    bench.sims = sims

    expect(bench.writes()).toEqual([])
    expect(bench.restarts()).toEqual([])
  })
})

describe('the properties a device should have', () => {
  it('writes only the properties that differ, and stops once they hold', () => {
    const bench = new Bench()

    bench.sim('primary').properties = { UPLOAD_MODE: { UPLOAD_CLIENT: false } }
    bench.poll(4)

    expect(bench.writes().map(write => [write.device, write.property, write.values])).toEqual([['primary', 'UPLOAD_MODE', { UPLOAD_CLIENT: true }]])
  })

  it('does not write a property that holds, within the tolerance', () => {
    const bench = new Bench()

    bench.sim('mount').properties.GEOGRAPHIC_COORD = { LAT: 33.4500004, LONG: 247.93, ELEV: 331 }
    bench.poll(3)

    expect(bench.writes('GEOGRAPHIC_COORD')).toEqual([])
  })

  it('does not write a property its driver has not defined yet, and writes it as soon as it is', () => {
    const bench = new Bench()

    delete bench.sim('mount').properties.GEOGRAPHIC_COORD
    bench.poll(6)
    expect(bench.writes('GEOGRAPHIC_COORD')).toEqual([])

    bench.sim('mount').properties.GEOGRAPHIC_COORD = { LAT: 0, LONG: 0, ELEV: 0 }
    bench.poll(1)
    expect(bench.writes('GEOGRAPHIC_COORD').map(write => write.values)).toEqual([site])
  })

  it('writes a property that does not take again after 10 s, 30 s and 60 s, and forgets the failures once it holds', () => {
    const bench = new Bench()
    const wrong = () => (bench.sim('primary').properties = { UPLOAD_MODE: { UPLOAD_CLIENT: false } })

    wrong()
    for (let i = 0; i < 30; i += 1) {
      bench.poll()
      wrong()
    }
    expect(bench.writes('UPLOAD_MODE').map(write => (write.at - 1_000_000) / 1000).slice(0, 4)).toEqual([5, 15, 45, 105])

    bench.sim('primary').properties = holdingProperties('primary')
    bench.poll()
    const before = bench.writes('UPLOAD_MODE').length

    wrong()
    bench.poll()
    expect(bench.writes('UPLOAD_MODE')).toHaveLength(before + 1)
  })

  it('writes the time once per connection, as UTC, once the program has seen the device connected, and again after it reconnects', () => {
    const bench = new Bench()

    bench.sim('mount').properties.TIME_UTC = { UTC: '2000-01-01T00:00:00', OFFSET: '0.00' }
    bench.poll(4)
    const first = bench.writes('TIME_UTC')

    expect(first).toEqual([{ at: 1_005_000, device: 'mount', property: 'TIME_UTC', values: { UTC: new Date(1_005_000).toISOString().slice(0, 19), OFFSET: '0.00' } }])

    bench.sim('mount').connection = 'disconnected'
    bench.poll(1)
    bench.sim('mount').connection = 'connected'
    bench.poll(3)

    expect(bench.writes('TIME_UTC')).toHaveLength(2)
  })

  it('waits for the time to be defined, and writes it once it is', () => {
    const other = new Bench()

    other.poll(6)
    expect(other.writes('TIME_UTC')).toEqual([])

    other.sim('mount').properties.TIME_UTC = { UTC: '2000-01-01T00:00:00', OFFSET: '0.00' }
    other.poll(3)
    expect(other.writes('TIME_UTC')).toHaveLength(1)
  })

  it('never writes a property that starts a motion or an exposure unless the rig file names it', () => {
    const bench = new Bench()

    bench.sim('focuser').connection = 'disconnected'
    bench.sim('primary').properties = { UPLOAD_MODE: { UPLOAD_CLIENT: false } }
    delete bench.sim('mount').properties.GEOGRAPHIC_COORD
    bench.poll(20)

    const allowed = new Set(['CONNECTION', 'UPLOAD_MODE', 'GEOGRAPHIC_COORD', 'TIME_UTC', 'DEVICE_PORT', 'DEBUG', 'DEBUG_LEVEL'])

    expect(bench.writes().every(write => allowed.has(write.property))).toBe(true)
  })
})

describe('a device that is missing from INDI while its hardware is present', () => {
  it('restarts only that driver, stop then start, once the picture has held for two polls', () => {
    const bench = new Bench()

    bench.missing('primary')
    bench.poll(1)
    expect(bench.restarts()).toEqual([])

    bench.poll(1)
    expect(bench.restarts()).toEqual([{ at: 1_005_000, driver: 'indi_asi_ccd' }])
  })

  it('does nothing while the hardware is absent, and starts counting when it appears', () => {
    const bench = new Bench()

    bench.missing('primary')
    bench.present.delete('primary')
    bench.poll(5)
    expect(bench.restarts()).toEqual([])

    bench.present.add('primary')
    bench.poll(1)
    expect(bench.restarts()).toEqual([])
    bench.poll(1)
    expect(bench.restarts()).toHaveLength(1)
  })

  it('does nothing for a device whose entry names no driver', () => {
    const bench = new Bench({}, [{ id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/mount', connected: true }, { id: 'box', indiDevice: 'Pegasus PPBA', serial: '/dev/serial/by-id/box', connected: true }])

    bench.missing('mount')
    bench.poll(5)

    expect(bench.restarts()).toEqual([])
  })

  it("waits while any property on a device that driver serves is Busy, such as another client's guide exposure", () => {
    const bench = new Bench()

    bench.missing('primary')
    bench.sim('guide').busy = ['CCD_EXPOSURE']
    bench.poll(20)

    expect(bench.restarts()).toEqual([])
    expect(bench.logs().filter(line => line.includes('guide CCD_EXPOSURE is Busy; not restarting'))).toHaveLength(1)

    bench.sim('guide').busy = []
    bench.poll(1)
    expect(bench.restarts()).toHaveLength(1)
  })

  it('backs off 20 s (the restart floor), 30 s, then 60 s, and resets once the device is defined', () => {
    const bench = new Bench()
    const gone = () => bench.missing('primary')

    gone()
    for (let i = 0; i < 60; i += 1) {
      bench.poll()
      gone()
    }

    const starts = bench.restarts().map(restart => restart.at)

    expect(starts.slice(1, 6).map((at, index) => Math.floor((at - starts[index]!) / 5000) * 5)).toEqual([20, 30, 60, 60, 60])

    bench.sims.set('primary', { connection: 'connected', properties: holdingProperties('primary'), busy: [] })
    bench.poll(3)
    const before = bench.restarts().length

    gone()
    bench.poll(3)
    expect(bench.restarts()).toHaveLength(before + 1)
  })

  it('never restarts one driver more than once in 20 s even when polls are faster', () => {
    const bench = new Bench()

    bench.missing('primary')
    for (let i = 0; i < 40; i += 1) {
      bench.poll()
      bench.now -= 4_000
      bench.missing('primary')
    }

    const starts = bench.restarts().map(restart => restart.at)

    expect(starts.length).toBeGreaterThan(0)
    expect(starts.slice(1).every((at, index) => at - starts[index]! >= 20_000)).toBe(true)
  })

  it('restarts two drivers independently', () => {
    const bench = new Bench()

    bench.missing('primary')
    bench.missing('focuser')
    bench.poll(2)

    expect(bench.restarts().map(restart => restart.driver).sort()).toEqual(['indi_asi_ccd', 'indi_asi_focuser'])
  })

  it('connects the device once the restarted driver defines it, and sets it up', () => {
    const bench = new Bench()

    bench.missing('primary')
    bench.poll(2)
    bench.poll(4)

    expect(bench.writes().filter(write => write.device === 'primary').map(write => write.property)).toEqual(['CONNECTION', 'UPLOAD_MODE'])
  })
})

describe('the dead driver of 2026-11-06 10:57 ET (indi_asi_focuser dumped core, both cameras disconnected, Cria off)', () => {
  it('restarts the focuser driver and connects both cameras, with nothing else running', () => {
    const bench = new Bench()

    bench.missing('focuser')
    bench.sim('primary').connection = 'disconnected'
    bench.sim('guide').connection = 'disconnected'
    bench.poll(6)

    expect(bench.restarts()).toEqual([{ at: 1_005_000, driver: 'indi_asi_focuser' }])
    expect(bench.writes('CONNECTION').filter(write => write.device !== 'focuser').map(write => [write.device, write.at - 1_000_000])).toEqual([['primary', 5_000], ['guide', 5_000]])
  })
})

describe('a dead link: the driver reports errors while the device still looks connected', () => {
  const second = 1000

  interface Drop {
    readonly label: string
    readonly devices: ReadonlyArray<string>
    readonly durationMs: number
    readonly busy?: ReadonlyArray<string>
  }

  const drops: ReadonlyArray<Drop> = [
    { label: '11-01 11:59:47 ET, 24.3 h, mount and box', devices: ['mount', 'box'], durationMs: 87_602 * second },
    { label: '11-02 17:17:34 ET, 6.4 min, mount and box', devices: ['mount', 'box'], durationMs: 383 * second },
    { label: '11-02 20:02:27 ET, about an hour, mount stuck with TELESCOPE_TRACK_STATE Busy', devices: ['mount', 'box'], durationMs: 3_990 * second, busy: ['TELESCOPE_TRACK_STATE'] },
    { label: '11-02 21:22:50 ET, 77 s, mount', devices: ['mount'], durationMs: 77 * second },
  ]

  const breakLink = (bench: Bench, drop: Drop) => {
    for (const id of drop.devices) bench.sim(id).brokenSince = bench.now
    if (drop.busy) bench.sim('mount').busy = [...drop.busy]
  }

  const elapsed = (bench: Bench, start: number) => (at: number) => (at - start) / second

  it.each(drops)('$label: reconnects 35 s in, then restarts the driver 60 s after that', drop => {
    const bench = new Bench()

    bench.poll(2)
    const start = bench.now
    const since = elapsed(bench, start)

    breakLink(bench, drop)
    bench.poll(60)

    const reconnects = bench.writes('CONNECTION').filter(write => 'DISCONNECT' in write.values)

    expect(reconnects.map(write => [write.device, since(write.at)])).toEqual(drop.devices.map(device => [device, 35]))
    expect(bench.restarts().map(restart => [restart.driver, since(restart.at)])).toEqual(drop.devices.map(device => [devices.find(candidate => candidate.id === device)!.driver, 95]))
    expect(bench.writes('CONNECTION').filter(write => 'CONNECT' in write.values).length).toBeGreaterThanOrEqual(drop.devices.length)
  })

  it.each(drops)('$label: the restarted driver is connected and set up again', drop => {
    const bench = new Bench()

    bench.poll(2)
    breakLink(bench, drop)
    bench.poll(30)

    for (const id of drop.devices) {
      expect(bench.sim(id).brokenSince).toBeUndefined()
      expect(bench.sim(id).connection).toBe('connected')
    }
    expect(bench.writes('TIME_UTC').length).toBeGreaterThanOrEqual(2)
  })

  it('does not restart the driver when the reconnect ended the errors, and says it recovered', () => {
    const bench = new Bench()

    bench.reconnectFixes = true
    bench.poll(2)
    breakLink(bench, drops[3]!)
    bench.poll(40)

    expect(bench.writes('CONNECTION').map(write => [write.device, Object.keys(write.values)[0]])).toEqual([['mount', 'DISCONNECT'], ['mount', 'CONNECT']])
    expect(bench.restarts()).toEqual([])
    expect(bench.logs()).toContain('rig: mount: reconnected, driver errors have stopped')
  })

  it('leaves a burst of 10 s alone: the longest power-off burst measured (10-24 02:28 ET)', () => {
    const bench = new Bench()

    bench.poll(2)
    bench.sim('mount').brokenSince = bench.now
    bench.poll(2)
    delete bench.sim('mount').brokenSince
    bench.poll(30)

    expect(bench.writes('CONNECTION')).toEqual([])
    expect(bench.restarts()).toEqual([])
  })

  it('leaves a single failed slew alone: three such pairs of errors came one at a time on 11-02 between 17:56 and 18:04 ET', () => {
    const bench = new Bench()
    const config = bench.config
    const snapshot = (last: number) => ({
      linked: true,
      devices: new Map(config.devices.map(device => [device.indiDevice, { ...factsOf(bench.sim(device.id), 0), ...(device.id === 'mount' ? { errorRun: { since: last, last } } : {}) }])),
    })
    let memory = bench.memory

    for (let i = 0; i < 40; i += 1) {
      const now = 2_000_000 + i * 5_000
      const decision = decide(config, { now, snapshot: snapshot(now - 300), hardware: Object.fromEntries(config.devices.map(device => [device.id, true])) }, memory)

      memory = decision.memory
      expect(decision.actions.filter(action => action.kind !== 'log' && !(action.kind === 'write' && action.property === 'TIME_UTC'))).toEqual([])
    }
  })

  it('ignores a USB device that reports errors: its loss is the missing-device rule', () => {
    const bench = new Bench()

    bench.poll(2)
    bench.sim('primary').brokenSince = bench.now
    bench.poll(40)

    expect(bench.writes('CONNECTION')).toEqual([])
    expect(bench.restarts()).toEqual([])
  })

  it('waits while the mount connects after the reconnect, instead of restarting its driver mid-connect', () => {
    const bench = new Bench()

    bench.poll(2)
    bench.sim('mount').brokenSince = bench.now
    bench.poll(8)
    bench.sim('mount').connection = 'changing'
    bench.poll(20)

    expect(bench.restarts()).toEqual([])
  })

  it('still waits for a Busy property of another device the same driver serves', () => {
    const bench = new Bench({}, [
      { id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/serial/by-id/mount', driver: 'indi_shared', connected: true },
      { id: 'box', indiDevice: 'Pegasus PPBA', serial: '/dev/serial/by-id/box', driver: 'indi_shared', connected: true },
    ])

    bench.poll(2)
    bench.sim('mount').brokenSince = bench.now
    bench.sim('box').busy = ['POWER_CHANNELS']
    bench.poll(40)

    expect(bench.restarts()).toEqual([])
    expect(bench.logs().some(line => line.includes('box POWER_CHANNELS is Busy; not restarting'))).toBe(true)
  })

  it('restarts the driver again when the same device fails again later', () => {
    const bench = new Bench()

    bench.poll(2)
    for (let round = 0; round < 3; round += 1) {
      bench.sim('mount').brokenSince = bench.now
      bench.poll(40)
      bench.sims.set('mount', { connection: 'connected', properties: holdingProperties('mount'), busy: [] })
    }

    expect(bench.restarts().length).toBe(3)
  })
})
