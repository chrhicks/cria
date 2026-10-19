/**
 * Stopping the mount, against a fake AM5 (review round 1: #3, #4, #6).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi } from '@cria/fake-indi'
import { addMount, moveMount } from './drivers.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const mount = 'ZWO AM5'
let fake: FakeIndi
let cria: Cria

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.behaviour = moveMount()
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['mount']))
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

const aborts = () => fake.received.filter(xml => xml.includes('name="TELESCOPE_ABORT_MOTION"')).length
const slew = { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' }
const moving = (property: string) => until(`${property} to go Busy`, () => fake.vector(mount, property).state === 'Busy', 5000)

describe('mount-stop (R1-#3)', () => {
  it('pre-empts a running slew instead of being refused busy', async () => {
    const slewing = await cria.submit('mount', 'mount-slew', slew)

    await moving('EQUATORIAL_EOD_COORD')
    const stop = await cria.submit('mount', 'mount-stop', {})

    expect(stop.status).toBe(202)
    expect((await cria.settled(stop.body.id)).kind).toBe('confirmed')
    expect((await cria.settled(slewing.body.id)).kind).toBe('stopped')
    expect(fake.vector(mount, 'EQUATORIAL_EOD_COORD').state).not.toBe('Busy')
  })

  it('still runs while the mount is quarantined, and leaves the quarantine held', async () => {
    fake.behaviour = (fake, vector, values) => (vector.name === 'TELESCOPE_TRACK_STATE' ? 'handled' : moveMount()(fake, vector, values))
    expect((await cria.run('mount', 'mount-tracking', { tracking: true })).kind).toBe('uncertain')
    expect((await cria.device('mount')).quarantine.held).toBe(true)

    const stop = await cria.submit('mount', 'mount-stop', {})

    expect(stop.status).toBe(202)
    expect((await cria.settled(stop.body.id)).kind).toBe('confirmed')
    expect(aborts()).toBe(1)
    expect((await cria.device('mount')).quarantine.held).toBe(true)
  })
})

describe('a slew the mount never acknowledges (R1-#4)', () => {
  it('is uncertain, and Cria still sends the stop because the mount may be moving', async () => {
    fake.behaviour = (fake, vector, values) => (vector.name === 'EQUATORIAL_EOD_COORD' ? 'handled' : moveMount()(fake, vector, values))
    const operation = await cria.run('mount', 'mount-slew', slew)

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(operation.message).toMatch(/no answer/)
    expect(aborts()).toBe(1)
  })
})

describe('a motion that started but did not complete as asked (R1-#5)', () => {
  it('a slew the mount abandons with Alert is uncertain, not failed: the mount moved', async () => {
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'EQUATORIAL_EOD_COORD') return moveMount()(fake, vector, values)
      fake.update(mount, vector.name, { state: 'Busy' })
      setTimeout(() => fake.update(mount, vector.name, { state: 'Alert', values: { RA: 3 }, message: 'slew aborted by mount' }), 200)

      return 'handled'
    }
    const operation = await cria.run('mount', 'mount-slew', slew)

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(operation.message).toMatch(/slew aborted by mount/)
  })

  it('a slew that settles away from the target is uncertain, not failed', async () => {
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'EQUATORIAL_EOD_COORD') return moveMount()(fake, vector, values)
      fake.update(mount, vector.name, { state: 'Busy' })
      setTimeout(() => fake.update(mount, vector.name, { state: 'Ok', values: { RA: 5, DEC: 0 } }), 200)

      return 'handled'
    }
    const operation = await cria.run('mount', 'mount-slew', slew)

    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
    expect(operation.message).toMatch(/outside the target tolerance/)
  })
})

describe('stopping a park or home (R1-#6)', () => {
  it('a cancelled park counts as stopped only when the park itself is no longer Busy', async () => {
    fake.behaviour = moveMount({ ignoreAbortFor: 'TELESCOPE_PARK' })
    const parking = await cria.submit('mount', 'mount-park', {})

    await moving('TELESCOPE_PARK')
    await cria.cancel(parking.body.id)
    const operation = await cria.settled(parking.body.id, 40_000)

    expect(fake.vector(mount, 'TELESCOPE_PARK').state).toBe('Busy')
    expect(operation).toMatchObject({ kind: 'uncertain', quarantined: true })
  }, 45_000)

  it('a cancelled park the mount does abort ends cancelled', async () => {
    const parking = await cria.submit('mount', 'mount-park', {})

    await moving('TELESCOPE_PARK')
    await cria.cancel(parking.body.id)

    expect((await cria.settled(parking.body.id)).kind).toBe('stopped')
  })
})

describe('axis motion rates (R1-#12)', () => {
  const sidereal = 15.041067 / 3600
  const motions = () => fake.received.filter(xml => xml.includes('name="TELESCOPE_MOTION_WE"')).length

  it('refuses a rate the mount does not advertise, before moving', async () => {
    const operation = await cria.run('mount', 'mount-axis', { rateDegreesPerSecond: 0.05, durationSeconds: 0.5 })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled', quarantined: false })
    expect(motions()).toBe(0)
  })

  it('refuses a rotate whose rate and distance point opposite ways, before moving', async () => {
    const operation = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 8 * sidereal, distanceDegrees: -1 })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled', quarantined: false })
    expect(motions()).toBe(0)
  })

  it('moves at an advertised rate (2x, labelled "2x" on the element named 4x)', async () => {
    fake.behaviour = moveMount({ finishAfterMs: 10_000 })
    const submitted = await cria.submit('mount', 'mount-axis', { rateDegreesPerSecond: 2 * sidereal, durationSeconds: 0.3 })
    const operation = await cria.settled(submitted.body.id)

    const switched = (name: string) =>
      fake.received.filter(xml => xml.startsWith('<newSwitchVector') && xml.includes(`name="${name}"`)).map(xml => [...xml.matchAll(/<oneSwitch name="(\w+)">\s*(On|Off)\s*</g)].map(([, element, value]) => `${element}=${value}`).join(' '))

    expect(switched('TELESCOPE_SLEW_RATE')).toEqual(['4x=On'])
    expect(switched('TELESCOPE_MOTION_WE')).toEqual(['MOTION_EAST=On', 'MOTION_EAST=Off MOTION_WEST=Off'])
    expect(operation).toMatchObject({ kind: 'confirmed', values: { rightAscensionDegrees: 30, rate: '4x' } })
  })
})

describe('a stop during the steps before a motion (review R2 P1-B)', () => {
  it('stops before the motion starts: only the abort is sent, and the axis motion ends cancelled', async () => {
    const motion = moveMount({ finishAfterMs: 10_000 })

    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'TELESCOPE_SLEW_RATE') return motion(fake, vector, values)
      setTimeout(() => {
        fake.apply(vector, values)
        fake.update(mount, vector.name, { state: 'Ok' })
      }, 400)

      return 'handled'
    }
    const axis = await cria.submit('mount', 'mount-axis', { rateDegreesPerSecond: (2 * 15.041067) / 3600, durationSeconds: 5 })

    await until('the slew rate to be sent', () => fake.received.some(xml => xml.startsWith('<newSwitchVector') && xml.includes('name="TELESCOPE_SLEW_RATE"')), 5000)
    const stop = await cria.submit('mount', 'mount-stop', {})

    expect((await cria.settled(axis.body.id)).kind).toBe('stopped')
    expect((await cria.settled(stop.body.id)).kind).toBe('confirmed')
    expect(fake.received.filter(xml => xml.includes('name="TELESCOPE_MOTION_WE"') && xml.includes('>On<'))).toEqual([])
    expect(aborts()).toBe(1)
  })
})

describe('a stop that pre-empts a slow-to-stop motion (review R2 P2)', () => {
  it('is admitted at once, and a retry of its request ID during the pre-emption gets the same operation', async () => {
    const motion = moveMount()

    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'TELESCOPE_ABORT_MOTION') return motion(fake, vector, values)
      fake.update(mount, vector.name, { state: 'Ok' })
      setTimeout(() => fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Alert' }), 1500)

      return 'handled'
    }
    const slewing = await cria.submit('mount', 'mount-slew', slew)

    await moving('EQUATORIAL_EOD_COORD')
    const requestId = crypto.randomUUID()
    const slewState = () => fake.vector(mount, 'EQUATORIAL_EOD_COORD').state
    const first = await cria.submit('mount', 'mount-stop', {}, requestId)
    const slewAtFirst = slewState()
    const retry = await cria.submit('mount', 'mount-stop', {}, requestId)

    expect([first.status, slewAtFirst]).toEqual([202, 'Busy'])
    expect([retry, slewState()]).toMatchObject([{ status: 202, body: { id: first.body.id } }, 'Busy'])
    expect((await cria.settled(first.body.id)).kind).toBe('confirmed')
    expect((await cria.settled(slewing.body.id)).kind).toBe('stopped')

    const third = await cria.submit('mount', 'mount-stop', {}, requestId)

    expect(third.body.id).toBe(first.body.id)
  })
})
