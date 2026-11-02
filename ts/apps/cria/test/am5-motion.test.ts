/**
 * "Stopped" on the AM5's recorded motions: Cria's real mount code against fake-indi playing the fixtures cut from
 * errai's recordings (`playMotion`, packages/fake-indi/fixtures/am5). Each move must finish only once the position
 * has stood still for a window after its last change, never on the first Idle or Ok, and a cached reply with the old
 * position, or an Ok sent while the mount still moves, must not finish it. The rule on bare readings is
 * `stopped.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, addMount, loadAm5Fixtures, playMotion, type Value } from '@cria/fake-indi'
import { allReady, startCria, until, type Cria, type Ending } from './harness.js'

const mount = 'ZWO AM5'
const coordinates = 'EQUATORIAL_EOD_COORD'
const positionReadMs = 250
const windowMs = positionReadMs - 20
const stationaryDegrees = 0.02
const sidereal = 15.041067 / 3600
const fixtures = loadAm5Fixtures()

interface Published {
  readonly at: number
  readonly ra: number
  readonly dec: number
}

let fake: FakeIndi
let cria: Cria
let published: Published[]

type Update = FakeIndi['update']

async function start(timeScale: number, use: readonly string[]) {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.update(mount, 'TELESCOPE_SLEW_RATE', { values: { '9x': true, '10x': false } })
  published = []

  const update: Update = fake.update.bind(fake)

  fake.update = (device, name, change) => {
    update(device, name, change)
    if (name !== coordinates) return
    const { RA, DEC } = fake.vector(device, name).elements

    published.push({ at: Date.now(), ra: Number(RA!.value) * 15, dec: Number(DEC!.value) })
  }
  playMotion(fake, mount, use.map(name => fixtures[name]!), { timeScale })
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, motion: { positionReadMs } }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['mount']))
}

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

const sent = (property: string) =>
  fake.received
    .filter(xml => xml.startsWith('<new') && xml.includes(`name="${property}"`))
    .map(xml => [...xml.matchAll(/<one\w+ name="(\w+)">\s*([^<]*?)\s*</g)].map(([, element, value]) => `${element}=${value}`).join(' '))

/** The last time the position moved by more than the tolerance between two of the mount's published readings. */
function lastMove(): Published {
  const moves = published.filter((reading, index) => {
    const previous = published[index - 1]

    return previous !== undefined && (Math.abs(reading.ra - previous.ra) > stationaryDegrees || Math.abs(reading.dec - previous.dec) > stationaryDegrees)
  })

  return moves.at(-1)!
}

/** A command arrives: run `then` as the driver handles it, before the fixture's reply plays. */
function onCommand(matches: (property: string, values: Record<string, string>) => boolean, then: () => void) {
  const behaviour = fake.behaviour

  fake.behaviour = (self, vector, values, client) => {
    if (matches(vector.name, values)) then()

    return behaviour(self, vector, values, client)
  }
}

/**
 * From the command until `ms` later, the driver answers from its cache: updates to the coordinates are held back, so
 * every read gets the position published before the command, and a reply that repeats it, Idle, is pushed at once.
 * When the cache is refreshed, the last held update lands.
 */
function cacheFor(ms: number) {
  const update: Update = fake.update.bind(fake)
  let held: { state?: 'Idle' | 'Ok' | 'Busy' | 'Alert'; values?: Record<string, Value> } | undefined
  let caching = false

  fake.update = (device, name, change) => {
    if (caching && name === coordinates) held = change
    else update(device, name, change)
  }

  return () => {
    caching = true
    update(mount, coordinates, { state: 'Idle' })
    setTimeout(() => {
      caching = false
      if (held !== undefined) update(mount, coordinates, held)
    }, ms).unref()
  }
}

const isHalt = (property: string, values: Record<string, string>) => property === 'TELESCOPE_MOTION_WE' && Object.values(values).every(value => value === 'Off')
const isAbort = (property: string) => property === 'TELESCOPE_ABORT_MOTION'

/** The position Cria reports is the one the mount came to rest at. */
function expectRestedAt(ending: Ending) {
  const rested = published.at(-1)!

  expect(Math.abs(Number(ending.values!.rightAscensionDegrees) - rested.ra)).toBeLessThan(stationaryDegrees)
}

/** The move ended only once the position had stood still for a window after it last changed. */
async function settledAfterTheCoast(id: string): Promise<{ readonly ending: Ending; readonly quietFor: number }> {
  const ending = await cria.settled(id, 30_000)

  return { ending, quietFor: Date.now() - lastMove().at }
}

const axis = (direction: 1 | -1) => ({ rateDegreesPerSecond: direction * 720 * sidereal, durationSeconds: 1 })

describe('a 9x axis move east with tracking off, whose coordinates read Idle throughout', () => {
  const name = 'rate-move-9x-east-idle-coast'

  it('is stopped only once the coast is over: the Idle at the halt is not the stop', async () => {
    await start(4, [name])
    const submitted = await cria.submit('mount', 'mount-axis', axis(1))
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expectRestedAt(ending)
    expect(sent('TELESCOPE_MOTION_WE')).toEqual(['MOTION_EAST=On', 'MOTION_EAST=Off MOTION_WEST=Off'])
  })

  it('is not stopped by a cached reply with the old position, Idle, sent after the halt', async () => {
    await start(4, [name])
    onCommand(isHalt, cacheFor(300))
    const submitted = await cria.submit('mount', 'mount-axis', axis(1))
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expectRestedAt(ending)
    expect(sent('TELESCOPE_MOTION_WE')).toEqual(['MOTION_EAST=On', 'MOTION_EAST=Off MOTION_WEST=Off'])
  })
})

describe('a 9x axis move west with tracking on, whose coordinates read Ok and never Idle', () => {
  const name = 'rate-move-9x-west-tracking'

  it('is stopped from where the position comes to rest, though no state ever says stopped', async () => {
    await start(4, [name])
    const submitted = await cria.submit('mount', 'mount-axis', axis(-1))
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expectRestedAt(ending)
  })

  it('is not stopped by a cached reply with the old position sent after the halt', async () => {
    await start(4, [name])
    onCommand(isHalt, cacheFor(300))
    const submitted = await cria.submit('mount', 'mount-axis', axis(-1))
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expectRestedAt(ending)
  })
})

describe('a goto that ends Ok', () => {
  const name = 'goto-ok'
  // The fixture is a goto of 4.7966 h of RA and 19.486 deg of Dec from where the fake mount starts (2 h, 40 deg).
  const target = { rightAscensionDegrees: 6.796637664 * 15, declinationDegrees: 40 - 19.486278372, coordinateSystem: 'topocentric' }

  it('is done when the position stands still after the Ok, and reports where it landed', async () => {
    await start(20, [name])
    const submitted = await cria.submit('mount', 'mount-slew', target)
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expect(Math.abs(Number(ending.values!.rightAscensionDegrees) - published.at(-1)!.ra)).toBeLessThan(stationaryDegrees)
    expect(sent(coordinates)).toHaveLength(1)
  })

  it('is not done by an Ok with the old position sent while the mount still moves', async () => {
    await start(20, [name])
    const submitted = await cria.submit('mount', 'mount-slew', target)

    await until('the goto under way', () => published.length >= 3, 5000)
    fake.update(mount, coordinates, { state: 'Ok', values: { RA: 2, DEC: 40 } })
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expect(Math.abs(Number(ending.values!.declinationDegrees) - target.declinationDegrees)).toBeLessThan(0.1)
    expect(sent(coordinates)).toHaveLength(1)
  })
})

describe('a home whose coordinates read Idle from the first reading and whose TELESCOPE_HOME reports Ok before the last move', () => {
  it('is done when the position stands still, not when TELESCOPE_HOME says Ok', async () => {
    await start(20, ['home-idle-coast'])
    const submitted = await cria.submit('mount', 'mount-home', {})
    const { ending, quietFor } = await settledAfterTheCoast(submitted.body.id)

    expect(ending.kind).toBe('confirmed')
    expect(fake.vector(mount, 'TELESCOPE_HOME').state).toBe('Ok')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expect(sent('TELESCOPE_HOME')).toEqual(['GO=On'])
  })
})

describe('a home that is aborted, whose abort is answered Ok and whose TELESCOPE_HOME stays Busy', () => {
  const name = 'home-abort'

  async function homeThenCancel() {
    const home = await cria.submit('mount', 'mount-home', {})

    await until('the home under way', () => published.length >= 3, 5000)
    await cria.cancel(home.body.id)

    return settledAfterTheCoast(home.body.id)
  }

  it('is stopped from the position alone, once the coast is over', async () => {
    await start(4, [name])
    const { ending, quietFor } = await homeThenCancel()

    expect(ending).toMatchObject({ kind: 'stopped', quarantined: false })
    expect(fake.vector(mount, 'TELESCOPE_HOME').state).toBe('Busy')
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expect(sent('TELESCOPE_ABORT_MOTION')).toEqual(['ABORT=On'])
  })

  it('is not stopped by a cached reply with the old position sent after the abort', async () => {
    await start(4, [name])
    onCommand(isAbort, cacheFor(300))
    const { ending, quietFor } = await homeThenCancel()

    expect(ending).toMatchObject({ kind: 'stopped', quarantined: false })
    expect(quietFor).toBeGreaterThanOrEqual(windowMs)
    expect(sent('TELESCOPE_ABORT_MOTION')).toEqual(['ABORT=On'])
  })
})
