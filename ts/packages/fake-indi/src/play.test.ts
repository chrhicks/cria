/**
 * The AM5 motion fixtures against the recordings they were cut from, and against Vela's measured profile of the
 * same recordings (build plan step 3, 87 motions over 19 recordings). The numbers compared, by fixture:
 *
 * - 9x rate moves (n=39): stop latency (median 1.002 s, max 1.043 s) and overshoot after the stop (median 4083.6",
 *   max 4414.2"). A fixture must lie in the profile's spread: from median - (max - median) up to max.
 * - goto (n=30): landing offset from the target at the first reading that is not Busy (median 3.83", max 8.89"),
 *   and no coast: the goto ends Ok and never reports Idle.
 * - home (n=5): coast, from the first Idle reading to the last reading that moved (median 12.3 s, max 21.5 s).
 * - abort of home (n=1, "too few to trust" in the profile): stop latency 1.942 s and overshoot 15915", the single
 *   sample the fixture was cut from. Compared to 1%, to show the fixture reproduces that measurement, not the spread.
 */
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { addMount } from './devices.js'
import { loadAm5Fixtures, parseMotionFixture, type MotionFixture } from './motion.js'
import { playMotion, type MotionClock } from './play.js'
import { FakeIndi, type FakeClient } from './server.js'

class ManualClock implements MotionClock {
  private time = 0
  private next = 0
  private readonly timers = new Map<number, { due: number; run: () => void }>()

  readonly now = () => this.time

  readonly after = (ms: number, run: () => void) => {
    const id = this.next++

    this.timers.set(id, { due: this.time + ms, run })

    return () => void this.timers.delete(id)
  }

  advance(ms: number): void {
    const end = this.time + ms

    for (;;) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.due <= end).sort(([a, x], [b, y]) => x.due - y.due || a - b)[0]

      if (due === undefined) break
      this.time = Math.max(this.time, due[1].due)
      this.timers.delete(due[0])
      due[1].run()
    }
    this.time = end
  }
}

const profile = {
  rate9x: { stopLatencyS: { median: 1.002, max: 1.043 }, overshootArcsec: { median: 4083.6, max: 4414.2 } },
  goto: { landingArcsec: { median: 3.83, max: 8.89 } },
  home: { coastS: { median: 12.3, max: 21.5 } },
  abortOfHome: { stopLatencyS: 1.942, overshootArcsec: 15915 },
}

const inSpread = ({ median, max }: { median: number; max: number }) => ({ low: 2 * median - max, high: max })

const device = 'Mount'
const arcsecPerHour = 15 * 3600
const noClient: FakeClient = { id: 0 }

interface Heard {
  /** Recorded milliseconds since the start command. */
  readonly ms: number
  readonly property: string
  readonly state: string
  readonly values: Record<string, number | boolean | string>
}

const fixtures = loadAm5Fixtures()
const fixture = (name: string): MotionFixture => fixtures[name]!

let fake: FakeIndi
let clock: ManualClock
let heard: Heard[]
let startedAt: number
let scale: number

function setUp(options: { start?: { RA: number; DEC: number }; timeScale?: number; use?: readonly string[] } = {}) {
  fake = new FakeIndi()
  clock = new ManualClock()
  heard = []
  scale = options.timeScale ?? 1
  addMount(fake, device)
  const start = options.start ?? { RA: 2, DEC: 40 }

  fake.update(device, 'EQUATORIAL_EOD_COORD', { values: start })
  fake.update(device, 'TELESCOPE_SLEW_RATE', { values: { '9x': true, '10x': false } })

  const update = fake.update.bind(fake)

  fake.update = (target, name, change) => {
    update(target, name, change)
    const vector = fake.vector(target, name)

    heard.push({
      ms: (clock.now() - startedAt) * scale,
      property: name,
      state: vector.state,
      values: Object.fromEntries(Object.entries(vector.elements).map(([element, { value }]) => [element, value])),
    })
  }
  playMotion(fake, device, options.use === undefined ? Object.values(fixtures) : options.use.map(fixture), { clock, timeScale: scale })
  startedAt = clock.now()
}

function send(name: string, values: Record<string, string>): 'default' | 'handled' {
  return fake.behaviour(fake, fake.vector(device, name), values, noClient)
}

const east = { MOTION_EAST: 'On', MOTION_WEST: 'Off' }
const allOff = { MOTION_EAST: 'Off', MOTION_WEST: 'Off' }

const readings = () => heard.filter(update => update.property === 'EQUATORIAL_EOD_COORD')

const axis = (update: Heard) => ({ x: Number(update.values.RA) * arcsecPerHour, y: Number(update.values.DEC) * 3600 })

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

/** The mount moved when it changed by more than 1.5 display steps (1 s of RA, 1" of Dec): the sidereal drift of a mount that is not tracking is one step. */
const moved = (a: Heard, b: Heard) => Math.abs(axis(b).x - axis(a).x) > 1.5 * 15 || Math.abs(axis(b).y - axis(a).y) > 1.5

function lastMoved(list: readonly Heard[]): Heard {
  return list.filter((update, index) => index > 0 && moved(list[index - 1]!, update)).at(-1)!
}

/**
 * Vela's measures of a stop (step 3): when the mount was last seen moving, how far it went on after where it was at the stop,
 * and how long it moved after the coordinates first said Idle (from the stop, if they said Idle already).
 */
function stopMeasures(stopMs: number) {
  const before = readings().filter(update => update.ms < stopMs)
  const after = readings().filter(update => update.ms > stopMs)
  const [a, b] = [axis(before.at(-2)!), axis(before.at(-1)!)]
  const seconds = (before.at(-1)!.ms - before.at(-2)!.ms) / 1000
  const velocity = { x: (b.x - a.x) / seconds, y: (b.y - a.y) / seconds }
  const speed = Math.hypot(velocity.x, velocity.y)
  const lag = (stopMs - before.at(-1)!.ms) / 1000
  const atStop = { x: b.x + velocity.x * lag, y: b.y + velocity.y * lag }
  const last = lastMoved([before.at(-1)!, ...after])
  const end = axis(last)
  const idleFrom = before.at(-1)!.state === 'Idle' ? stopMs : after.find(update => update.state === 'Idle')?.ms

  return {
    stopLatencyS: (last.ms - stopMs) / 1000,
    overshootArcsec: ((end.x - atStop.x) * velocity.x + (end.y - atStop.y) * velocity.y) / speed,
    coastS: idleFrom === undefined ? undefined : (last.ms - idleFrom) / 1000,
  }
}

describe('the fixtures', () => {
  it('are the five motions cut from the recordings, each readable', () => {
    expect(Object.keys(fixtures)).toEqual(['goto-ok', 'home-abort', 'home-idle-coast', 'rate-move-9x-east-idle-coast', 'rate-move-9x-west-tracking'])
  })

  it('refuse a file that is out of time order', () => {
    const base = JSON.parse(JSON.stringify(fixture('goto-ok')))

    base.start.steps.reverse()
    expect(() => parseMotionFixture(base)).toThrow('Motion fixture goto-ok: steps are not in time order')
    expect(() => parseMotionFixture({ ...base, format: 2 })).toThrow('format 1 with a name and about is required')
  })
})

describe('a 9x move east with tracking off, replayed against the raw recording', () => {
  it('sends the recorded updates in the recorded order and at the recorded times, the stop included', () => {
    const start = 1.9533333333333333
    // Read off the recording (2026-10-23, 756.141 s to 761.3 s): the AM5's RA after the move and the stop, at its own times.
    const recorded: Array<[ms: number, property: string, state: string, ra?: number]> = [
      [0, 'TELESCOPE_MOTION_WE', 'Busy'],
      [44, 'EQUATORIAL_EOD_COORD', 'Idle', 1.9538888888888888],
      [1069, 'EQUATORIAL_EOD_COORD', 'Idle', 2.0972222222222223],
      [2093, 'EQUATORIAL_EOD_COORD', 'Idle', 2.3030555555555554],
      [3118, 'EQUATORIAL_EOD_COORD', 'Idle', 2.5091666666666668],
      [3149, 'TARGET_EOD_COORD', 'Idle', 2.5091666666666668],
      [3190, 'TELESCOPE_MOTION_WE', 'Idle'],
      [4142, 'EQUATORIAL_EOD_COORD', 'Idle', 2.5905555555555555],
      [5165, 'EQUATORIAL_EOD_COORD', 'Idle', 2.5908333333333333],
    ]

    setUp({ start: { RA: start, DEC: 90 }, use: ['rate-move-9x-east-idle-coast'] })
    expect(send('TELESCOPE_MOTION_WE', east)).toBe('handled')
    clock.advance(3148)
    expect(send('TELESCOPE_MOTION_WE', allOff)).toBe('handled')
    clock.advance(5000)

    expect(heard.map(update => [update.ms, update.property, update.state])).toEqual(recorded.map(([ms, property, state]) => [ms, property, state]))
    for (const [index, [, , , ra]] of recorded.entries()) if (ra !== undefined) expect(Number(heard[index]!.values.RA)).toBeCloseTo(ra, 7)
  })

  it('reports Idle on every reading while the mount still moves after the stop', () => {
    setUp({ use: ['rate-move-9x-east-idle-coast'] })
    send('TELESCOPE_MOTION_WE', east)
    clock.advance(3148)
    send('TELESCOPE_MOTION_WE', allOff)
    clock.advance(5000)

    const after = readings().filter(update => update.ms > 3148)

    expect(after.map(update => update.state)).toEqual(['Idle', 'Idle'])
    expect(moved(readings().filter(update => update.ms <= 3148).at(-1)!, after[0]!)).toBe(true)
  })

  it('has a stop latency and an overshoot inside the 9x profile', () => {
    setUp({ use: ['rate-move-9x-east-idle-coast'] })
    send('TELESCOPE_MOTION_WE', east)
    clock.advance(3148)
    send('TELESCOPE_MOTION_WE', allOff)
    clock.advance(5000)

    const { stopLatencyS, overshootArcsec } = stopMeasures(3148)

    expect(stopLatencyS).toBeGreaterThanOrEqual(inSpread(profile.rate9x.stopLatencyS).low)
    expect(stopLatencyS).toBeLessThanOrEqual(inSpread(profile.rate9x.stopLatencyS).high)
    expect(overshootArcsec).toBeGreaterThanOrEqual(inSpread(profile.rate9x.overshootArcsec).low)
    expect(overshootArcsec).toBeLessThanOrEqual(inSpread(profile.rate9x.overshootArcsec).high)
  })

  it('goes on at the pace of its last two readings when the stop comes late, and stops from where it then is', () => {
    setUp({ use: ['rate-move-9x-east-idle-coast'] })
    send('TELESCOPE_MOTION_WE', east)
    clock.advance(6200)
    expect(readings().map(update => update.ms)).toEqual([44, 1069, 2093, 3118, 4143, 5168, 6193])

    send('TELESCOPE_MOTION_WE', allOff)
    clock.advance(5000)
    const { overshootArcsec } = stopMeasures(6200)

    expect(overshootArcsec).toBeGreaterThan(inSpread(profile.rate9x.overshootArcsec).low)
    expect(overshootArcsec).toBeLessThan(inSpread(profile.rate9x.overshootArcsec).high)
  })

  it('plays the stop at once and leaves nothing of the run behind when it comes before the first reading', () => {
    setUp({ use: ['rate-move-9x-east-idle-coast'] })
    send('TELESCOPE_MOTION_WE', east)
    clock.advance(20)
    send('TELESCOPE_MOTION_WE', allOff)
    clock.advance(10_000)

    expect(heard.map(update => update.property)).toEqual(['TELESCOPE_MOTION_WE', 'TARGET_EOD_COORD', 'TELESCOPE_MOTION_WE', 'EQUATORIAL_EOD_COORD', 'EQUATORIAL_EOD_COORD'])
  })
})

describe('a move on the Dec axis', () => {
  it('stops from where the mount would be on both axes: a made-up fixture, since no recording holds a rate move on Dec', () => {
    const north = parseMotionFixture({
      format: 1,
      name: 'made-up-north',
      about: 'Not cut from a recording.',
      source: { recording: 'none', startAtS: 0 },
      start: {
        command: { property: 'TELESCOPE_MOTION_NS', on: 'MOTION_NORTH' },
        continue: { everyMs: 1000, offset: { RA: 0, DEC: 0.1 } },
        steps: [
          { afterMs: 1000, property: 'EQUATORIAL_EOD_COORD', state: 'Idle', offset: { RA: 0.01, DEC: 0.1 } },
          { afterMs: 2000, property: 'EQUATORIAL_EOD_COORD', state: 'Idle', offset: { RA: 0.02, DEC: 0.2 } },
        ],
      },
      stop: {
        command: { property: 'TELESCOPE_MOTION_NS', allOff: true },
        steps: [{ afterMs: 500, property: 'EQUATORIAL_EOD_COORD', state: 'Idle', offset: { RA: 0.005, DEC: 0.05 } }],
      },
    })

    fake = new FakeIndi()
    clock = new ManualClock()
    addMount(fake, device)
    fake.update(device, 'EQUATORIAL_EOD_COORD', { values: { RA: 5, DEC: 10 } })
    playMotion(fake, device, [north], { clock })
    send('TELESCOPE_MOTION_NS', { MOTION_NORTH: 'On', MOTION_SOUTH: 'Off' })
    clock.advance(2500)
    send('TELESCOPE_MOTION_NS', { MOTION_NORTH: 'Off', MOTION_SOUTH: 'Off' })
    clock.advance(500)

    const { elements } = fake.vector(device, 'EQUATORIAL_EOD_COORD')

    expect(Number(elements.RA!.value)).toBeCloseTo(5 + 0.025 + 0.005, 9)
    expect(Number(elements.DEC!.value)).toBeCloseTo(10 + 0.25 + 0.05, 9)
  })
})

describe('a 9x move west with tracking on', () => {
  it('never reports Idle on the coordinates, and stops inside the 9x profile', () => {
    setUp({ use: ['rate-move-9x-west-tracking'] })
    send('TELESCOPE_MOTION_WE', { MOTION_WEST: 'On', MOTION_EAST: 'Off' })
    clock.advance(6579)
    send('TELESCOPE_MOTION_WE', allOff)
    clock.advance(10_000)

    const { stopLatencyS, overshootArcsec } = stopMeasures(6579)

    expect(readings().map(update => update.state)).toEqual(Array(readings().length).fill('Ok'))
    expect(stopLatencyS).toBeGreaterThanOrEqual(inSpread(profile.rate9x.stopLatencyS).low)
    expect(stopLatencyS).toBeLessThanOrEqual(inSpread(profile.rate9x.stopLatencyS).high)
    expect(Math.abs(overshootArcsec)).toBeLessThanOrEqual(inSpread(profile.rate9x.overshootArcsec).high)
    expect(Math.abs(overshootArcsec)).toBeGreaterThanOrEqual(inSpread(profile.rate9x.overshootArcsec).low)
  })
})

describe('a goto', () => {
  it('goes Busy at once, ends Ok within the profile\'s landing spread, and never reports Idle', () => {
    const goto = fixture('goto-ok').start.command

    if (!('travel' in goto)) throw new Error('the goto fixture records its travel')
    setUp({ start: { RA: 20, DEC: 30 }, use: ['goto-ok'] })
    const target = { RA: (20 + goto.travel.RA) % 24, DEC: 30 + goto.travel.DEC }

    expect(send('EQUATORIAL_EOD_COORD', { RA: String(target.RA), DEC: String(target.DEC) })).toBe('handled')
    clock.advance(20_000)

    const states = readings().map(update => update.state)
    const landed = readings().find(update => update.state !== 'Busy')!
    const wanted = { x: target.RA * arcsecPerHour, y: target.DEC * 3600 }

    expect(heard[0]).toMatchObject({ property: 'TARGET_EOD_COORD', state: 'Idle' })
    expect(states[0]).toBe('Busy')
    expect(states.at(-1)).toBe('Ok')
    expect(states).not.toContain('Idle')
    expect(landed).toBe(readings().at(-1))
    expect(distance(axis(landed), wanted)).toBeLessThanOrEqual(inSpread(profile.goto.landingArcsec).high)
    expect(heard.at(-1)).toMatchObject({ ms: 13658, property: 'EQUATORIAL_EOD_COORD' })
    expect(heard.filter(update => update.property === 'TELESCOPE_TRACK_STATE').map(update => [update.state, update.values.TRACK_ON])).toEqual([
      ['Idle', false],
      ['Busy', true],
    ])
  })

  it('leaves a goto of another size to the fake\'s own behaviour', () => {
    setUp({ start: { RA: 2, DEC: 40 }, use: ['goto-ok'] })

    expect(send('EQUATORIAL_EOD_COORD', { RA: '3', DEC: '41' })).toBe('default')
    clock.advance(20_000)
    expect(heard).toEqual([])
  })
})

describe('a home', () => {
  it('reports Idle from its first reading and keeps moving for as long as the profile says', () => {
    setUp({ start: { RA: 6, DEC: 40 }, use: ['home-idle-coast'] })
    expect(send('TELESCOPE_HOME', { GO: 'On' })).toBe('handled')
    clock.advance(20_000)

    const list = readings()
    const coastS = (lastMoved(list).ms - list[0]!.ms) / 1000

    expect(new Set(list.map(update => update.state))).toEqual(new Set(['Idle']))
    expect(coastS).toBeGreaterThanOrEqual(inSpread(profile.home.coastS).low)
    expect(coastS).toBeLessThanOrEqual(inSpread(profile.home.coastS).high)
    expect(heard.find(update => update.property === 'TELESCOPE_HOME' && update.state === 'Ok')!.ms).toBeLessThan(lastMoved(list).ms)
    expect(Math.max(...list.map(update => Number(update.values.DEC)))).toBeLessThanOrEqual(90)
  })

  it('keeps Dec within the poles when it starts near one', () => {
    setUp({ start: { RA: 6, DEC: 80 }, use: ['home-idle-coast'] })
    send('TELESCOPE_HOME', { GO: 'On' })
    clock.advance(20_000)

    expect(Math.max(...readings().map(update => Number(update.values.DEC)))).toBe(90)
  })
})

describe('an abort of a home', () => {
  it('acknowledges Ok, leaves TELESCOPE_HOME Busy, and coasts as the one recorded abort did', () => {
    setUp({ start: { RA: 6, DEC: 40 }, use: ['home-abort'] })
    send('TELESCOPE_HOME', { GO: 'On' })
    clock.advance(4259)
    expect(send('TELESCOPE_ABORT_MOTION', { ABORT: 'On' })).toBe('handled')
    clock.advance(10_000)

    const { stopLatencyS, overshootArcsec, coastS } = stopMeasures(4259)

    expect(heard.filter(update => update.property === 'TELESCOPE_ABORT_MOTION').map(update => [update.state, update.values.ABORT])).toEqual([['Ok', false]])
    expect(fake.vector(device, 'TELESCOPE_HOME').state).toBe('Busy')
    expect(new Set(readings().map(update => update.state))).toEqual(new Set(['Idle']))
    expect(stopLatencyS).toBeCloseTo(profile.abortOfHome.stopLatencyS, 1)
    expect(Math.abs(overshootArcsec - profile.abortOfHome.overshootArcsec) / profile.abortOfHome.overshootArcsec).toBeLessThan(0.01)
    expect(coastS).toBeCloseTo(profile.abortOfHome.stopLatencyS, 1)
  })

  it('does nothing for an abort when no home is playing', () => {
    setUp({ use: ['home-abort'] })

    expect(send('TELESCOPE_ABORT_MOTION', { ABORT: 'On' })).toBe('default')
  })
})

describe('commands no fixture is cut from', () => {
  it('go to the behaviour the fake had, and the wrong rate is one of them', () => {
    setUp({ use: ['rate-move-9x-east-idle-coast'] })
    fake.update(device, 'TELESCOPE_SLEW_RATE', { values: { '9x': false, '8x': true } })

    expect(send('TELESCOPE_MOTION_WE', east)).toBe('default')
    expect(send('TELESCOPE_MOTION_NS', { MOTION_NORTH: 'On', MOTION_SOUTH: 'Off' })).toBe('default')
  })

  it('are replaced by a new motion that starts while one plays, the old tail included', () => {
    setUp({ use: ['home-idle-coast'] })
    send('TELESCOPE_HOME', { GO: 'On' })
    clock.advance(2000)
    send('TELESCOPE_HOME', { GO: 'On' })
    clock.advance(20_000)

    expect(heard.filter(update => update.property === 'TELESCOPE_HOME' && update.state === 'Ok').map(update => update.ms)).toEqual([2000 + 12666])
  })
})

describe('scaled in time', () => {
  it('plays the same updates in the same order, a fiftieth of the time apart', () => {
    setUp({ use: ['home-idle-coast'] })
    send('TELESCOPE_HOME', { GO: 'On' })
    clock.advance(20_000)
    const normal = heard.map(update => [update.ms, update.property, update.state])

    setUp({ use: ['home-idle-coast'], timeScale: 50 })
    send('TELESCOPE_HOME', { GO: 'On' })
    clock.advance(20_000 / 50)

    expect(heard.map(update => [Math.round(update.ms), update.property, update.state])).toEqual(normal)
  })
})

describe('on the wire', () => {
  let socket: net.Socket

  afterEach(async () => {
    socket.destroy()
    await fake.stop()
  })

  it('sends the properties of a home in the recorded order, to a client that asked for the mount', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, device)
    playMotion(fake, device, [fixture('home-idle-coast')], { timeScale: 200 })
    socket = net.connect(fake.port, '127.0.0.1')
    let text = ''

    socket.on('data', chunk => void (text += chunk.toString('utf8')))
    await new Promise(resolve => socket.once('connect', resolve))
    socket.write(`<getProperties version="1.7" device="${device}"/>`)
    for (let waited = 0; !text.includes('name="TELESCOPE_PIER_SIDE"'); waited += 5) {
      if (waited > 3000) throw new Error('no definitions')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    text = ''
    socket.write(`<newSwitchVector device="${device}" name="TELESCOPE_HOME"><oneSwitch name="GO">On</oneSwitch></newSwitchVector>`)
    for (let waited = 0; (text.match(/<setNumberVector/g)?.length ?? 0) < 8; waited += 5) {
      if (waited > 3000) throw new Error(`Timed out; received ${text.slice(-300)}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    const sets = [...text.matchAll(/<set(\w+)Vector device="[^"]+" name="(\w+)" state="(\w+)"/g)].map(match => [match[2], match[3]])
    const recorded = fixture('home-idle-coast').start.steps.map(step => [step.property, step.state])

    expect(sets.slice(0, 8)).toEqual(recorded.slice(0, 8))
  })
})
