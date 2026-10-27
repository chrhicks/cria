/**
 * Stopping a home on the AM5. indi_lx200am5 leaves TELESCOPE_HOME Busy after an
 * acknowledged abort and never marks the coordinates Busy while homing, so a
 * stop is judged by whether the coordinates move, not by that flag
 * (observed on errai, 2026-10-26).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, addMount, type Behaviour } from '@cria/fake-indi'
import { moveMount } from './drivers.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const mount = 'ZWO AM5'
const coordinates = 'EQUATORIAL_EOD_COORD'
let fake: FakeIndi
let cria: Cria
let drift: NodeJS.Timeout | undefined

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.behaviour = homeThatIgnoresAbort()
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, motion: { positionReadMs: 300 } }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['mount']))
})

afterEach(async () => {
  clearInterval(drift)
  await cria.stop()
  await fake.stop()
})

/** The driver answers an abort Ok and leaves TELESCOPE_HOME Busy; the coordinates never go Busy. */
function homeThatIgnoresAbort(): Behaviour {
  return moveMount({ ignoreAbortFor: 'TELESCOPE_HOME' })
}

const aborts = () => fake.received.filter(xml => xml.includes('name="TELESCOPE_ABORT_MOTION"')).length
const homing = () => until('TELESCOPE_HOME to go Busy', () => fake.vector(mount, 'TELESCOPE_HOME').state === 'Busy', 5000)

async function startHome() {
  const home = await cria.submit('mount', 'mount-home', {})

  await homing()

  return home.body.id
}

describe('a client stop during home', () => {
  it('confirms from still coordinates when the driver leaves TELESCOPE_HOME Busy, and holds nothing', async () => {
    const home = await startHome()

    await cria.cancel(home)
    const operation = await cria.settled(home, 40_000)

    expect(fake.vector(mount, 'TELESCOPE_HOME').state).toBe('Busy')
    expect(fake.vector(mount, coordinates).state).toBe('Idle')
    expect(operation).toMatchObject({ kind: 'stopped', quarantined: false })
    expect((await cria.device('mount')).quarantine.held).toBe(false)

    const next = await cria.run('mount', 'mount-tracking', { tracking: true })

    expect(next).toMatchObject({ kind: 'confirmed', quarantined: false })
  }, 45_000)

  it('stays uncertain and held when the coordinates keep changing', async () => {
    const home = await startHome()
    let ra = 2

    drift = setInterval(() => fake.update(mount, coordinates, { values: { RA: (ra += 0.01) } }), 100)
    await cria.cancel(home)
    const operation = await cria.settled(home, 40_000)

    expect(operation).toMatchObject({ kind: 'uncertain', reason: 'stop-not-confirmed', quarantined: true })
    expect((await cria.device('mount')).quarantine.held).toBe(true)
  }, 45_000)

  it('stays uncertain and held when the coordinates stop being readable', async () => {
    const home = await startHome()
    const motion = homeThatIgnoresAbort()

    fake.behaviour = (fake, vector, values) => {
      const handled = motion(fake, vector, values)

      if (vector.name === 'TELESCOPE_ABORT_MOTION') fake.mute(mount)

      return handled
    }
    await cria.cancel(home)
    const operation = await cria.settled(home, 40_000)

    expect(operation).toMatchObject({ kind: 'uncertain', reason: 'stop-not-confirmed', quarantined: true })
  }, 45_000)

  it('stays uncertain and held when the abort is never acknowledged', async () => {
    const home = await startHome()
    const motion = homeThatIgnoresAbort()

    fake.behaviour = (fake, vector, values) => (vector.name === 'TELESCOPE_ABORT_MOTION' ? 'handled' : motion(fake, vector, values))
    await cria.cancel(home)
    const operation = await cria.settled(home, 40_000)

    expect(operation).toMatchObject({ kind: 'uncertain', reason: 'stop-not-confirmed', quarantined: true })
    expect(aborts()).toBeGreaterThan(1)
  }, 45_000)

  it('stays uncertain and held when another motion property is still Busy', async () => {
    const home = await startHome()
    const motion = homeThatIgnoresAbort()

    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'TELESCOPE_ABORT_MOTION') return motion(fake, vector, values)
      fake.update(mount, 'TELESCOPE_PARK', { state: 'Busy' })
      fake.update(mount, vector.name, { state: 'Ok' })

      return 'handled'
    }
    await cria.cancel(home)
    const operation = await cria.settled(home, 40_000)

    expect(operation).toMatchObject({ kind: 'uncertain', reason: 'stop-not-confirmed', quarantined: true })
  }, 45_000)
})

describe('a home nobody stops', () => {
  it('completes when the driver sets TELESCOPE_HOME Ok', async () => {
    fake.behaviour = moveMount({ finishAfterMs: 300 })

    const operation = await cria.run('mount', 'mount-home', {})

    expect(operation).toMatchObject({ kind: 'confirmed', quarantined: false })
    expect(aborts()).toBe(0)
  })
})
