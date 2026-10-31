/**
 * The mount failures errai really produced, replayed as drivers' words on the fake AM5
 * (`am5` in drivers.ts) against the real Cria. Each case is one episode from the recorded
 * INDI traffic (docs/testing.md, "Cases from recorded failures"); the dates are those of
 * the nights, the exchanges are those in `am5`'s comments. The mount is the one device
 * that holds on an uncertain ending (cria#34).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, addMount } from '@cria/fake-indi'
import { am5, type Am5Options, type FakeAm5 } from './drivers.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const mount = 'ZWO AM5'
const site = { latitudeDegrees: 40.0, longitudeDegrees: -75, elevationMeters: 0 }
const sidereal = 15.041067 / 3600
let fake: FakeIndi
let model: FakeAm5
let cria: Cria

async function start(options: Am5Options, declination?: number) {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  if (declination !== undefined) fake.update(mount, 'EQUATORIAL_EOD_COORD', { values: { DEC: declination } })
  model = am5(fake, mount, options)
  fake.behaviour = model.behaviour
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, site, motion: { positionReadMs: 300 } }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['mount']))
}

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

/** What Cria wrote to one property, as `ELEMENT=value` lines. */
const sent = (property: string) =>
  fake.received
    .filter(xml => xml.startsWith('<new') && xml.includes(`name="${property}"`))
    .map(xml => [...xml.matchAll(/<one\w+ name="(\w+)">\s*([^<]*?)\s*</g)].map(([, element, value]) => `${element}=${value}`).join(' '))

const held = async () => (await cria.device('mount')).quarantine.held

describe('a home stopped on the AM5 (errai, 2026-10-26 23:33 and 2026-10-27 01:28)', () => {
  it('leaves TELESCOPE_HOME Busy after an acknowledged abort; the mount coasts, then Cria confirms the stop from still coordinates and holds nothing', async () => {
    await start({ publishEveryMs: 100 }, 40)
    const home = await cria.submit('mount', 'mount-home', {})

    await until('TELESCOPE_HOME to go Busy', () => fake.vector(mount, 'TELESCOPE_HOME').state === 'Busy', 5000)
    // Recorded: tracking dropped 365 ms into the home; the coordinates are Idle throughout.
    await until('tracking to drop', () => fake.vector(mount, 'TELESCOPE_TRACK_STATE').elements.TRACK_OFF!.value === true, 5000)
    expect(fake.vector(mount, 'EQUATORIAL_EOD_COORD').state).toBe('Idle')
    await until('the mount to be moving toward home', () => model.position().dec > 43, 5000)

    // Recorded: the abort came 1.0 s into the home.
    await cria.cancel(home.body.id)
    const ending = await cria.settled(home.body.id, 40_000)

    expect(sent('TELESCOPE_ABORT_MOTION')).toEqual(['ABORT=On'])
    expect([ending.kind, ending.quarantined]).toEqual(['stopped', false])
    // The driver never set TELESCOPE_HOME back, and Cria did not wait for that: it waited for the mount to stand still.
    expect(fake.vector(mount, 'TELESCOPE_HOME').state).toBe('Busy')
    expect(fake.vector(mount, 'EQUATORIAL_EOD_COORD').state).toBe('Idle')
    expect(model.moving()).toBe(false)
    expect(model.position().dec).toBeGreaterThan(model.haltedAt()!.dec)
    expect(model.position().dec).toBeLessThan(90)
  }, 45_000)

  it('arrives at home: TELESCOPE_HOME Ok, coordinates Idle at Dec 90', async () => {
    await start({ publishEveryMs: 100, slewDegreesPerSecond: 40 }, 40)
    const ending = await cria.run('mount', 'mount-home', {})

    expect([ending.kind, ending.quarantined]).toEqual(['confirmed', false])
    expect(fake.vector(mount, 'TELESCOPE_HOME').state).toBe('Ok')
    expect(model.position().dec).toBe(90)
  }, 45_000)
})

describe('an axis motion when the mount loses power (errai, 2026-10-29 evening)', () => {
  it('answers the stop with Alert and "Error stopping W/E motion.": the stop is not confirmed, the motion is not resent, and the mount is held', async () => {
    await start({ publishEveryMs: 100 })
    const rotating = await cria.submit('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 10 })

    await until('the axis to be moving', () => fake.vector(mount, 'TELESCOPE_MOTION_WE').state === 'Busy', 5000)
    model.cutPower()
    const ending = await cria.settled(rotating.body.id, 60_000)

    expect([ending.kind, ending.reason, ending.quarantined]).toEqual(['uncertain', 'stop-not-confirmed', true])
    expect(await held()).toBe(true)
    // One start, however long it took; the stop was written again and again (recorded: five over 17 s).
    expect(sent('TELESCOPE_MOTION_WE').filter(line => line.includes('=On'))).toEqual(['MOTION_EAST=On'])
    expect(sent('TELESCOPE_MOTION_WE').filter(line => !line.includes('=On')).length).toBeGreaterThan(1)

    const next = await cria.submit('mount', 'mount-tracking', { tracking: true })

    expect(next.status).toBe(409)
  }, 70_000)
})

describe('an axis motion at Home, answered Idle (errai, 2026-10-30 evening)', () => {
  it('is a refusal, not silence: the rotate fails rejected, nothing is stopped or held', async () => {
    await start({ rotateIdleAtPole: true }, 90)
    const started = Date.now()
    const ending = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 20 })

    expect([ending.kind, ending.reason, ending.quarantined]).toEqual(['failed', 'rejected', false])
    expect(ending.message).toContain('the driver answered Idle and did not start MOTION_EAST (it stayed Off)')
    // The driver answered in 41 ms and Cria did not wait for the 600 ms acknowledgement deadline.
    expect(Date.now() - started).toBeLessThan(500)
    // The start was written once and nothing was sent after it: the driver said it did not start.
    expect(sent('TELESCOPE_MOTION_WE')).toEqual(['MOTION_EAST=On'])
    expect(fake.vector(mount, 'TELESCOPE_MOTION_WE').state).toBe('Idle')
    expect(model.moving()).toBe(false)
    expect(await held()).toBe(false)
    expect((await cria.run('mount', 'mount-tracking', { tracking: true })).kind).toBe('confirmed')
  }, 45_000)

  it('the same rotate away from the pole starts as before: Busy is the answer', async () => {
    await start({ rotateIdleAtPole: true }, 80)
    const ending = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 60 * sidereal, distanceDegrees: 1 })

    expect([ending.kind, ending.quarantined]).toEqual(['confirmed', false])
    expect(sent('TELESCOPE_MOTION_WE').filter(line => line.includes('=On'))).toEqual(['MOTION_EAST=On'])
  }, 45_000)
})
