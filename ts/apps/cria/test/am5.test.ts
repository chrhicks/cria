import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, addMount, am5, type Am5Options, type FakeAm5 } from './fake-indi.js'
import { allReady, startCria, until, valueOf, type Cria, type DeviceSpec } from './harness.js'

const mount = 'ZWO AM5'
const site = { latitudeDegrees: 40.0, longitudeDegrees: -75, elevationMeters: 0 }
const sidereal = 15.041067 / 3600
let fake: FakeIndi
let model: FakeAm5
let cria: Cria

async function start(options: Am5Options, spec: Partial<DeviceSpec> = { site }) {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  model = am5(fake, mount, options)
  fake.behaviour = model.behaviour
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, ...spec }], { acknowledgeMs: 600 })
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

describe('a goto on an AM5 that needs its site and time', () => {
  it('is accepted: Cria wrote the configured site, then the time, after the mount connected', async () => {
    await start({ slewDegreesPerSecond: 10, publishEveryMs: 100 })
    const operation = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: 31, declinationDegrees: 45, coordinateSystem: 'topocentric' })

    expect([operation.kind, operation.message]).toEqual(['confirmed', null])
    expect(sent('GEOGRAPHIC_COORD')).toEqual(['LAT=40 LONG=285 ELEV=0'])
    expect(sent('TIME_UTC')).toEqual([expect.stringMatching(/^UTC=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d OFFSET=0\.00$/)])
    expect(fake.received.findIndex(xml => xml.includes('name="GEOGRAPHIC_COORD"'))).toBeLessThan(fake.received.findIndex(xml => xml.includes('name="TIME_UTC"')))
  })

  it('without a configured site, is refused with a message that says what the mount needs and what Cria sent', async () => {
    await start({}, {})
    const operation = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: 31, declinationDegrees: 45, coordinateSystem: 'topocentric' })

    expect([operation.kind, operation.reason, operation.quarantined]).toEqual(['failed', 'rejected', false])
    expect(operation.message).toBe(
      'The mount refused the goto (Alert on EQUATORIAL_EOD_COORD). An AM5 refuses every goto until its site and time are set after it powers on. ' +
        `Setup since it connected: GEOGRAPHIC_COORD not sent: no site is configured for this mount; sent TIME_UTC ${sent('TIME_UTC')[0]}`,
    )
    expect(sent('GEOGRAPHIC_COORD')).toEqual([])
  })
})

describe('stopping a mount that coasts after the driver says it stopped', () => {
  const slewDown = { rightAscensionDegrees: 30, declinationDegrees: 20, coordinateSystem: 'topocentric' }
  const pastDec = (dec: number) => until(`the mount below Dec ${dec}`, () => model.position().dec < dec, 10_000)

  it('a cancel mid-slew settles stopped only once the mount stands still, and reports where it stopped', async () => {
    await start({ requireSiteAndTime: false })
    const slewing = await cria.submit('mount', 'mount-slew', slewDown)

    await pastDec(37)
    await cria.cancel(slewing.body.id)
    const operation = await cria.settled(slewing.body.id)
    const stillMovingAtSettle = model.moving()
    const stoppedAt = model.position().dec

    expect([operation.kind, stillMovingAtSettle]).toEqual(['stopped', false])
    expect(stoppedAt).toBeLessThan(model.haltedAt()!.dec - 2)
    expect(valueOf(await cria.device('mount'), 'declinationDegrees')).toBe(stoppedAt)
  })

  it('a mount-stop pre-empting a slew is confirmed only once the mount stands still', async () => {
    await start({ requireSiteAndTime: false })
    const slewing = await cria.submit('mount', 'mount-slew', slewDown)

    await pastDec(37)
    const stop = await cria.submit('mount', 'mount-stop', {})
    const stopped = await cria.settled(stop.body.id)

    expect([stopped.kind, model.moving(), (await cria.settled(slewing.body.id)).kind]).toEqual(['confirmed', false, 'stopped'])
  })

  it('tells a still, untracked mount from a moving one: the sidereal drift is not motion', async () => {
    await start({ requireSiteAndTime: false })
    const ra = model.position().ra

    await until('the untracked mount to drift', () => model.position().ra > ra + 0.004, 5000)
    expect((await cria.run('mount', 'mount-stop', {})).kind).toBe('confirmed')
  })

  it('a stop the mount acknowledges but never completes ends uncertain: stop-not-confirmed', async () => {
    await start({ requireSiteAndTime: false, neverStops: true })
    const slewing = await cria.submit('mount', 'mount-slew', slewDown)

    await pastDec(37)
    await cria.cancel(slewing.body.id)
    const operation = await cria.settled(slewing.body.id, 40_000)

    expect([operation.kind, operation.reason, operation.quarantined, model.moving()]).toEqual(['uncertain', 'stop-not-confirmed', true, true])
  }, 45_000)
})

describe('mount-rotate on an AM5 whose axis stops 0.9 s after the halt', () => {
  const travelled = () => model.position().ra - startRa
  let startRa = 0

  it("leads the stop: 1° at the driver's 8x (0.2507°/s) ends within 0.1° of 1°, and reports the distance really travelled", async () => {
    await start({ publishEveryMs: 100 })
    startRa = model.position().ra
    const operation = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 60 * sidereal, distanceDegrees: 1 })

    await until('the mount to stand still', () => !model.moving())
    expect(operation.kind).toBe('confirmed')
    expect(travelled()).toBeGreaterThan(0.9)
    expect(travelled()).toBeLessThan(1.1)
    expect(operation.values).toMatchObject({ rate: '8x', travelledDegrees: expect.closeTo(travelled(), 3) })
  })

  it("at the driver's 9x (3.008°/s) sends the halt 2.7° early and reports the distance really travelled", async () => {
    await start({ publishEveryMs: 100 })
    startRa = model.position().ra
    const operation = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 10 })

    await until('the mount to stand still', () => !model.moving())
    expect(operation.kind).toBe('confirmed')
    expect(model.haltedAt()!.ra - startRa).toBeCloseTo(10 - 720 * sidereal * 0.9, 0)
    expect(operation.values).toMatchObject({ rate: '9x', travelledDegrees: expect.closeTo(travelled(), 3) })
  })

  it('refuses a rate whose stop lead is more than half the distance, before moving', async () => {
    await start({})
    const operation = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 1 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'At 3.008°/s the mount travels about 2.71° after Cria sees the target (900 ms), more than 50 % of the 1° asked; use a slower rate or a longer rotate',
    ])
    expect(sent('TELESCOPE_MOTION_WE')).toEqual([])
  })
})
