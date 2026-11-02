import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { MountEnvelope } from '@cria/wire'
import { FakeIndi, addMount, loadAm5Fixtures, playMotion } from '@cria/fake-indi'
import { gotoRefusal, rateRefusal, stopTravelDegrees, type MountPose } from '../src/capability/envelope.js'
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

    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid', quarantined: false })
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

describe('the pure box rule', () => {
  it('allows the full alignment sweep on the normal east side', () => {
    expect(gotoRefusal(envelope, pose(-130, 80, 'west'), pose(-16, 80, 'west'), 15)).toBeUndefined()
  })

  it('checks both possible landing sides near the meridian', () => {
    expect(gotoRefusal(envelope, pose(-30, 80, 'west'), pose(-10, 80, 'west'), 15)).toContain('flipped-side')
    expect(gotoRefusal(envelope, pose(-10, 80, 'west'), pose(10, 80, 'east'), 15)).toBeUndefined()
  })

  it('uses zero when the meridian limit is unread', () => {
    expect(rateRefusal(envelope, pose(1, 80, 'west'), 0.1, 0)).toContain('meridian limit 0°')
  })

  it('reserves the measured stop travel', () => {
    expect(stopTravelDegrees).toBeCloseTo(1.13444444)
  })
})
