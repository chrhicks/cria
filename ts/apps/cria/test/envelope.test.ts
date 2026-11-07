import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { MountEnvelope } from '@cria/wire'
import { FakeIndi, addMount, loadAm5Fixtures, playMotion } from '@cria/fake-indi'
import { gotoRefusal, rateRefusal, stopTravelDegrees, marginArcmin, reactionDegrees, watchRefusal } from '../src/capability/envelope.js'
import type { MountPose } from '../src/capability/goto-reach.js'
import { originalEnvelope, splitEnvelope } from './envelope-fixtures.js'
import { allReady, startCria, type Cria } from './harness.js'

const rig = JSON.parse(readFileSync(new URL('../../../deploy/rig.errai.json', import.meta.url), 'utf8'))
const envelope = Schema.decodeUnknownSync(MountEnvelope)(rig.devices.find((device: { kind: string }) => device.kind === 'mount').envelope)
const mount = 'ZWO AM5'
const fixtures = loadAm5Fixtures()
const sidereal = 15.041067 / 3600
let fake: FakeIndi
let cria: Cria

async function start(ha: number, dec: number, side: 'east' | 'west' | 'unknown', limit: number | null = 15, configured = true) {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  playMotion(fake, mount, Object.values(fixtures).filter(fixture => fixture.name !== 'home-abort'), { timeScale: 20 })
  fake.update(mount, 'ON_COORD_SET', { values: { TRACK: false, SLEW: true } })
  fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Ok', values: { RA: ((-ha + 360) % 360) / 15, DEC: dec } })
  fake.update(mount, 'TELESCOPE_PIER_SIDE', { values: { PIER_EAST: side === 'east', PIER_WEST: side === 'west' } })
  fake.define({ device: mount, name: 'TIME_LST', kind: 'number', perm: 'ro', state: 'Ok', elements: { LST: { value: 0 } } })
  if (limit !== null) fake.define({ device: mount, name: 'MERIDIAN_LIMIT', kind: 'number', perm: 'rw', state: 'Ok', elements: { LIMIT: { value: limit } } })
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, ...(configured ? { envelope } : {}), motion: { positionReadMs: 250 } }])
  await cria.waitFor(allReady(['mount']))
  fake.received.length = 0
}

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

const commands = () => fake.received.filter(xml => xml.startsWith('<new'))
const slew = (ha: number, dec: number) => cria.run('mount', 'mount-slew', {
  rightAscensionDegrees: (-ha + 360) % 360, declinationDegrees: dec, coordinateSystem: 'topocentric',
})
const pose = (hourAngleDegrees: number, declinationDegrees: number, pierSide: MountPose['pierSide']): MountPose => ({ hourAngleDegrees, declinationDegrees, pierSide })

describe('the configured stub before any command is sent', () => {
  it.each([[57, 90], [66, 90], [29, 60]])('refuses the normal-side contact at HA %s, Dec %s', async (ha, dec) => {
    await start(0, dec, 'east')
    const result = await slew(ha, dec)

    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' })
    expect(result.message).toContain('west HA limit')
    expect(commands()).toEqual([])
  })

  it('checks the full box when both endpoints and the straight line are safe', async () => {
    await start(35, 80, 'east')
    const result = await slew(16, 60)

    expect(result.message).toContain('west middle Dec')
    expect(commands()).toEqual([])
  })

  it('refuses a rate move from an unsafe start, even heading away', async () => {
    await start(57, 90, 'east')
    const result = await cria.run('mount', 'mount-axis', { rateDegreesPerSecond: 720 * sidereal, durationSeconds: 1 })

    expect(result.message).toContain('west HA limit')
    expect(commands()).toEqual([])
  })

  it('checks a rotate before sending a rate selection', async () => {
    await start(17, 60, 'east')
    const result = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: -720 * sidereal, distanceDegrees: -10 })

    expect(result.message).toContain('west HA limit')
    expect(commands()).toEqual([])
  })

  it('refuses a safe rate endpoint when its stop travel crosses the limit', async () => {
    await start(19, 60, 'east')
    const result = await cria.run('mount', 'mount-axis', { rateDegreesPerSecond: -720 * sidereal, durationSeconds: 0.1 })

    expect(result.message).toContain('west HA limit')
    expect(commands()).toEqual([])
  })

  it('plays the recorded goto on the clear east side', async () => {
    await start(-16, 80, 'west')
    const result = await cria.run('mount', 'mount-slew', {
      rightAscensionDegrees: 16 + 4.796637664 * 15, declinationDegrees: 80 - 19.486278372, coordinateSystem: 'topocentric',
    })

    expect(result.kind).toBe('confirmed')
    expect(result.operation.motion?.stopped.how).toBe('arrived')
    expect(commands().some(xml => xml.includes('EQUATORIAL_EOD_COORD'))).toBe(true)
  })

  it.each([['west', 16], ['east', -16]] as const)('refuses flipped %s beyond the driver limit at HA %s', async (side, ha) => {
    await start(ha, 80, side)
    const result = await slew(ha, 80)

    expect(result.message).toContain('flipped-side meridian limit 15°')
    expect(commands()).toEqual([])
  })

  it('allows a recorded rate move on the flipped side within the driver limit', async () => {
    await start(10, 80, 'west')
    const result = await cria.run('mount', 'mount-axis', { rateDegreesPerSecond: 720 * sidereal, durationSeconds: 0.1 })

    expect(result.kind).toBe('confirmed')
    expect(commands().some(xml => xml.includes('TELESCOPE_MOTION_WE'))).toBe(true)
  })

  it('uses the actual driver limit rather than assuming 15 degrees', async () => {
    await start(10, 80, 'west', 5)
    const result = await slew(10, 80)

    expect(result.message).toContain('flipped-side meridian limit 5°')
    expect(commands()).toEqual([])
  })

  it('treats an unread meridian limit as zero', async () => {
    await start(1, 80, 'west', null)
    const result = await slew(1, 80)

    expect(result.message).toContain('flipped-side meridian limit 0°')
    expect(commands()).toEqual([])
  })

  it('refuses a goto with an unknown pier side', async () => {
    await start(-50, 80, 'unknown')
    const result = await slew(-60, 80)

    expect(result.message).toContain('known pier side')
    expect(commands()).toEqual([])
  })

  it.each(['mount-home', 'mount-park'])('exempts %s even from an unsafe pose with an unknown side', async kind => {
    await start(57, 90, 'unknown')
    expect((await cria.run('mount', kind, {})).kind).toBe('confirmed')
    expect(commands().length).toBeGreaterThan(0)
  })

  it('preserves existing behavior without an envelope', async () => {
    await start(57, 90, 'unknown', 15, false)
    expect((await slew(58, 90)).kind).toBe('confirmed')
  })
})

describe('gotos from the AM5 north-pole home', () => {
  const homes = [pose(-90, 89.9, 'west'), pose(90, 89.9, 'east'), pose(-90, 90, 'west'), pose(90, 90, 'east'), pose(-89.99, 90, 'west'), pose(89.99, 89.9, 'east'), pose(-90.01, 89.9, 'west'), pose(90.01, 89.9, 'east')]

  it.each(homes)('allows normal east and west targets from $hourAngleDegrees, $declinationDegrees, $pierSide', from => {
    for (const ha of [-40, 40]) {
      expect(gotoRefusal(originalEnvelope, from, pose(ha, 50, ha < 0 ? 'west' : 'east'), 15)).toBeUndefined()
    }
  })

  it.each(homes)('predicts a normal landing inside the driver limit from $pierSide at $declinationDegrees', from => {
    expect(gotoRefusal(originalEnvelope, from, pose(-10, 50, 'west'), 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, from, pose(10, 50, 'east'), 15)).toBeUndefined()
  })

  it.each(['east', 'west'] as const)('sends no command for a tight-band refusal while tracking from %s home', async side => {
    await start(side === 'west' ? -90 : 90, 89.9, side)
    const { instanceId } = await cria.state()
    await cria.client.envelope('mount', { instanceId, envelope: originalEnvelope })
    fake.update(mount, 'TELESCOPE_TRACK_STATE', { values: { TRACK_ON: true, TRACK_OFF: false } })
    await cria.waitFor(state => state.devices[0]!.readings.tracking?.status === 'fresh' && state.devices[0]!.readings.tracking.value === true)
    fake.received.length = 0
    const result = await slew(0, 50)

    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' })
    expect(result.message).toContain('Envelope')
    expect(commands()).toEqual([])
  })

  it.each(['east', 'west'] as const)('bounds the same-side home HA tolerance on %s', pierSide => {
    const sign = pierSide === 'west' ? -1 : 1
    const target = pose(-sign * 40, 50, pierSide === 'west' ? 'east' : 'west')
    expect(gotoRefusal(originalEnvelope, pose(sign * 89.96, 89.9, pierSide), target, 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, pose(sign * 89.95, 89.9, pierSide), target, 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, pose(sign * 90.05, 89.9, pierSide), pose(sign * 40, 50, pierSide), 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, pose(sign * 90.06, 89.9, pierSide), pose(sign * 40, 50, pierSide), 15)).toContain('HA limit')
    expect(gotoRefusal(originalEnvelope, pose(sign * 89.94, 89.9, pierSide), target, 15)).toBeUndefined()
  })

  it('checks physical side changes beyond the former pole shortcut', () => {
    expect(gotoRefusal(originalEnvelope, pose(-90, 89, 'west'), pose(40, 50, 'east'), 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, pose(-90, 88.99, 'west'), pose(40, 50, 'east'), 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, pose(-40, 50, 'west'), pose(40, 50, 'east'), 15)).toBeUndefined()
    expect(gotoRefusal(originalEnvelope, pose(-40, 50, 'west'), pose(-60, 50, 'west'), 15)).toBeUndefined()
  })

  it('keeps the reported start check and refuses an unmeasured pole representation', () => {
    expect(gotoRefusal(originalEnvelope, pose(90, 89.9, 'west'), pose(-40, 50, 'west'), 15)).toContain('flipped-side')
    expect(gotoRefusal(originalEnvelope, pose(-170, 89.9, 'west'), pose(-40, 50, 'west'), 15)).toContain('east HA limit')
  })

  it('checks the folded path through the pole rather than dropping an unmeasured band', () => {
    const gap = { ...originalEnvelope, keepOut: originalEnvelope.keepOut.filter(band => band.name !== 'normal near pole') }
    expect(gotoRefusal(gap, pose(-90, 89.9, 'west'), pose(40, 50, 'east'), 15)).toContain('unmeasured Dec band')
  })
})

describe('goto endpoint reserve through fake INDI', () => {
  const cases = [
    { home: -90, side: 'west', target: -40 },
    { home: -90, side: 'west', target: 40 },
    { home: 90, side: 'east', target: -40 },
    { home: 90, side: 'east', target: 40 },
  ] as const

  async function runGoto(table: number | 'split', home: number, side: MountPose['pierSide'], target: number, startDec = 89.9) {
    await start(home, startDec, side)
    const sent = table === 'split' ? splitEnvelope : { ...originalEnvelope, keepOut: originalEnvelope.keepOut.map(band => band.name === 'normal measured'
      ? { ...band, eastHourAngleDegrees: -table, westHourAngleDegrees: table } : band) }
    const { instanceId } = await cria.state()
    await cria.client.envelope('mount', { instanceId, envelope: sent })
    const previous = fake.behaviour
    const timers: ReturnType<typeof setTimeout>[] = []
    const ra = (ha: number) => ((-ha + 360) % 360) / 15
    fake.behaviour = (server, vector, values, client) => {
      if (vector.name === 'TELESCOPE_ABORT_MOTION') {
        timers.forEach(clearTimeout)
        server.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Ok' })
        return 'default'
      }
      if (vector.name !== 'EQUATORIAL_EOD_COORD') return previous(server, vector, values, client)
      server.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Busy' })
      const origin = target < 0 ? -90 : 90
      for (const [delay, ha, dec] of [[100, origin, 89.9], [300, origin * 0.99, 89.5], [600, (origin + target) / 2, 70], [900, target, 50]] as const) {
        timers.push(setTimeout(() => {
          server.update(mount, 'TELESCOPE_PIER_SIDE', { values: { PIER_WEST: target < 0, PIER_EAST: target > 0 } })
          server.update(mount, 'EQUATORIAL_EOD_COORD', { state: delay === 900 ? 'Ok' : 'Busy', values: { RA: ra(ha), DEC: dec } })
        }, delay))
      }
      return 'handled'
    }
    fake.received.length = 0
    try {
      const result = await slew(target, 50)
      return { result, sent: commands() }
    } finally {
      timers.forEach(clearTimeout)
    }
  }

  it.each(cases.filter(row => Math.sign(row.home) === Math.sign(row.target)))('keeps the original +/-90 table refusal from $home to $target', async ({ home, side, target }) => {
    const { result, sent } = await runGoto(90, home, side, target)
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' })
    expect(result.message).toContain('envelope margin')
    expect(sent).toEqual([])
  })

  it.each(cases)('completes from $home to $target with a synthetic wider normal band', async ({ home, side, target }) => {
    const { result, sent } = await runGoto(115, home, side, target)
    expect(result.kind).toBe('confirmed')
    expect(result.operation.motion?.stopped.how).toBe('arrived')
    expect(sent.some(xml => xml.includes('EQUATORIAL_EOD_COORD'))).toBe(true)
    expect(sent.some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(false)
  })

  it.each([...cases, ...cases.map(row => ({ ...row, home: Math.sign(row.home) * 90.01 }))])('completes from $home to $target with the split measured bands', async ({ home, side, target }) => {
    const { result, sent } = await runGoto('split', home, side, target)
    expect(result.kind).toBe('confirmed')
    expect(result.operation.motion?.stopped.how).toBe('arrived')
    expect(sent.some(xml => xml.includes('EQUATORIAL_EOD_COORD'))).toBe(true)
    expect(sent.some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(false)
  })

  it('refuses a clear target whose reserved overshoot leaves the normal band before any command', async () => {
    const { result, sent } = await runGoto(115, -40, 'west', -112, 50)
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' })
    expect(result.message).toContain('east HA limit -115')
    expect(sent).toEqual([])
  })
})

describe('the pure box rule', () => {
  it('allows the full alignment sweep on the normal east side', () => {
    expect(gotoRefusal(envelope, pose(-130, 80, 'west'), pose(-16, 80, 'west'), 15)).toBeUndefined()
  })

  it('checks the normal landing within the driver limit and both at the meridian', () => {
    expect(gotoRefusal(envelope, pose(-30, 80, 'west'), pose(-10, 80, 'west'), 15)).toBeUndefined()
    expect(gotoRefusal(envelope, pose(-10, 80, 'west'), pose(0, 80, 'east'), 15)).toContain('west HA limit 40')
    expect(gotoRefusal(originalEnvelope, pose(-10, 80, 'west'), pose(10, 80, 'east'), 15)).toBeUndefined()
  })

  it('uses zero when the meridian limit is unread', () => {
    expect(rateRefusal(envelope, pose(1, 80, 'west'), 0.1, 0)).toContain('meridian limit 0°')
  })

  it('reserves the measured stop travel', () => {
    expect(stopTravelDegrees).toBeCloseTo(1.13444444)
  })
})

it('uses the sent envelope in the path check and retains every accepted fix until replaced', async () => {
  await start(0, 80, 'east')
  const { instanceId } = await cria.state()
  const sent = { ...envelope, keepOut: envelope.keepOut.map(band => ({ ...band, westHourAngleDegrees: 5 })) }
  expect((await cria.client.envelope('mount', { instanceId, envelope: sent })).status).toBe(200)
  expect((await slew(10, 80)).message).toContain('west HA limit 5')
  expect(commands()).toEqual([])

  for (const capturedAt of [1000, 2000]) {
    const fix = { capturedAt, rightAscensionDegrees: 120, declinationDegrees: 30, coordinateSystem: 'j2000', pointingErrorArcmin: null, error: { scaleError: 0.01, hintOffsetDegrees: 0.2 } }
    expect((await cria.client.fix('mount', { instanceId, fix })).status).toBe(200)
    expect((await cria.client.feedback('mount')).fix).toEqual(fix)
  }
  expect((await cria.client.fix('mount', { instanceId, fix: { capturedAt: -1 } })).status).toBe(400)
  expect((await cria.client.feedback('mount')).envelope).toEqual(sent)
})

it('grows the uncertainty with blind travel and uses the profile maximum without a positional error', () => {
  expect(marginArcmin(2, 100)).toBeCloseTo(2 + 100 * 7.02 / 60)
  expect(marginArcmin(null, 0)).toBeCloseTo(15915.2 / 60)
  expect(marginArcmin(1, 0)).toBeLessThan(marginArcmin(2, 100))
  expect(watchRefusal(envelope, pose(-130, 80, 'west'), 15, marginArcmin(null, 114) / 60, reactionDegrees)).toBeUndefined()
})

it.each(['goto', 'rate', 'slow-ack'] as const)('aborts a drifting %s through the confirmed stop path before the west limit', async kind => {
  const slow = kind === 'slow-ack'
  await start(10, 80, 'east')
  const rate = fixtures['rate-move-9x-west-tracking']!
  // Synthetic drift, with the recorded rate readings and stop coast retained.
  playMotion(fake, mount, [{ ...rate,
    start: { ...rate.start, steps: slow ? [
      { afterMs: 1900, property: 'EQUATORIAL_EOD_COORD', state: 'Busy', offset: { RA: -11.4 / 15, DEC: 0 } },
      { afterMs: 2926, property: 'EQUATORIAL_EOD_COORD', state: 'Busy', offset: { RA: -17.556 / 15, DEC: 0 } },
    ] : rate.start.steps.map(step => kind === 'goto' && step.property === 'EQUATORIAL_EOD_COORD' ? { ...step, state: 'Busy' as const } : step), command: kind !== 'rate'
      ? { property: 'EQUATORIAL_EOD_COORD', travel: { RA: -6 / 15, DEC: 0 } }
      : rate.start.command },
    stop: { ...rate.stop!, command: { property: 'TELESCOPE_ABORT_MOTION', on: 'ABORT' } },
  }], { timeScale: slow ? 1 : 5 })
  const { instanceId } = await cria.state()
  if (slow) await cria.client.envelope('mount', { instanceId, envelope: { ...envelope, keepOut: envelope.keepOut.map(band => ({ ...band, westHourAngleDegrees: 35 })) } })
  await cria.client.fix('mount', { instanceId, fix: { capturedAt: Date.now(), rightAscensionDegrees: 350, declinationDegrees: 80, coordinateSystem: 'j2000', pointingErrorArcmin: 1, error: { scaleError: 0, hintOffsetDegrees: 0 } } })
  const result = kind !== 'rate' ? await slew(16, 80)
    : await cria.run('mount', 'mount-axis', { rateDegreesPerSecond: -720 * sidereal, durationSeconds: 1 })
  expect(result.kind, result.message ?? '').toBe('uncertain')
  expect(result.message).toContain('west HA limit')
  expect(result.message).toContain('margin')
  expect(result.operation.motion?.stopped).toMatchObject({ how: 'aborted', reason: expect.stringContaining('envelope margin') })
  const end = result.operation.motion!.observed.to!
  expect(360 - end.rightAscensionDegrees).toBeLessThan(slow ? 35 : 40)
  expect(commands().some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(true)
}, 15_000)
