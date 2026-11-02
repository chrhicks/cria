import { afterEach, expect, it } from 'vitest'
import { FakeIndi, addMount, handControllerMove } from '@cria/fake-indi'
import { allReady, startCria, type Cria } from './harness.js'
import { makeForeignMotion } from '../src/capability/foreign-motion.js'

let fake: FakeIndi
let cria: Cria
const mount = 'ZWO AM5'
const coordinates = 'EQUATORIAL_EOD_COORD'

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

async function start() {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.update(mount, 'TELESCOPE_TRACK_STATE', { values: { TRACK_ON: true, TRACK_OFF: false } })
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount }])
  await cria.waitFor(allReady(['mount']))
}

it('flags a hand-controller move, holds without sending commands, and clears on human recovery', async () => {
  await start()
  const sent = fake.received.filter(xml => xml.startsWith('<new')).length
  handControllerMove(fake, mount, { raDegrees: 0.03, decDegrees: -0.04 })
  const held = await cria.waitFor(state => state.devices[0]!.quarantine.held)
  const device = held.devices[0]!

  expect(device).toMatchObject({ availability: { ready: false, reason: 'blocked' }, foreignMotion: {
    at: expect.any(Number), from: { rightAscensionDegrees: 30, declinationDegrees: 40 },
    to: { rightAscensionDegrees: expect.closeTo(30.03, 6), declinationDegrees: 39.96 },
    unexplained: { rightAscensionDegrees: expect.closeTo(0.03, 3), declinationDegrees: expect.closeTo(-0.04, 6) },
  } })
  expect(await cria.submit('mount', 'mount-home', {})).toMatchObject({ ok: false, body: { error: { code: 'device-blocked' } } })
  expect(fake.received.filter(xml => xml.startsWith('<new'))).toHaveLength(sent)
  const recovery = await cria.client.recover('mount', { instanceId: held.instanceId, bindingId: device.bindingId, externalRecoveryConfirmed: true, note: 'Fixture checked by a person' })
  expect(recovery.ok).toBe(true)
  await cria.waitFor(allReady(['mount']))
  expect(await cria.device('mount')).not.toHaveProperty('foreignMotion')
  expect((await cria.device('mount')).bindingId).not.toBe(device.bindingId)
  handControllerMove(fake, mount, { raDegrees: 0, decDegrees: 0.04 })
  await cria.waitFor(state => state.devices[0]!.quarantine.held)
})

it('accumulates slow foreign movement across sub-tolerance readouts', async () => {
  await start()
  for (let i = 0; i < 5; i++) handControllerMove(fake, mount, { raDegrees: 0, decDegrees: 0.005 })
  await cria.waitFor(state => state.devices[0]!.quarantine.held)
})

it('does not flag steady tracking or quantisation near the tolerance', () => {
  const detector = makeForeignMotion(0.02)
  detector.tracking(true, 0)
  expect(detector.record({ ra: 359.99, dec: 40, at: 0 }, false)).toBeUndefined()
  for (let i = 1; i <= 100; i++)
    expect(detector.record({ ra: (359.99 + (i % 2) * 0.019) % 360, dec: 40, at: i * 1025 }, false)).toBeUndefined()
  expect(detector.record({ ra: 0.011, dec: 40, at: 104_000 }, false)).toBeDefined()
})

it('removes sidereal drift with tracking off, including wrap and tracking changes', () => {
  const detector = makeForeignMotion(0.02)
  detector.tracking(false, 0)
  const sidereal = 360 / 86_164_090.5
  for (let i = 0; i <= 100; i++) {
    const at = i * 10_000
    expect(detector.record({ ra: (359 + at * sidereal) % 360, dec: 40, at }, false)).toBeUndefined()
  }
  detector.tracking(true, 1_000_000)
  expect(detector.record({ ra: (359 + 1_000_000 * sidereal) % 360, dec: 40, at: 2_000_000 }, false)).toBeUndefined()
  expect(detector.record({ ra: (359 + 1_000_000 * sidereal) % 360, dec: 40.021, at: 2_001_000 }, false)).toBeDefined()
})

it('allows normal tracking on and off through fake INDI', async () => {
  await start()
  fake.update(mount, 'TELESCOPE_TRACK_STATE', { values: { TRACK_ON: true, TRACK_OFF: false } })
  for (let i = 0; i < 10; i++) fake.update(mount, coordinates, { values: { RA: 2 + (i % 2) * 0.001, DEC: 40 } })
  fake.update(mount, coordinates, { values: { RA: 2, DEC: 40 } })
  fake.update(mount, 'TELESCOPE_TRACK_STATE', { values: { TRACK_ON: false, TRACK_OFF: true } })
  const since = Date.now()
  await cria.waitFor(state => state.generatedAt - since >= 1500)
  fake.update(mount, coordinates, { values: { RA: 2 + (Date.now() - since) * (360 / 86_164_090.5) / 15, DEC: 40 } })
  const state = await cria.waitFor(allReady(['mount']))
  expect(state.devices[0]!.quarantine.held).toBe(false)
})

it('uses the first polled position after connect, not the driver definition placeholder', async () => {
  await start()
  fake.update(mount, 'CONNECTION', { values: { CONNECT: false, DISCONNECT: true } })
  fake.update(mount, 'CONNECTION', { values: { CONNECT: true, DISCONNECT: false } })
  fake.define({ device: mount, name: coordinates, kind: 'number', perm: 'rw', state: 'Idle', elements: { RA: { value: 0 }, DEC: { value: 0 } } })
  fake.update(mount, coordinates, { values: { RA: 0, DEC: 90 } })
  await cria.waitFor(state => {
    const device = state.devices[0]!
    return device.kind === 'mount' && device.readings.declinationDegrees.status === 'fresh' && device.readings.declinationDegrees.value === 90
  })
  expect((await cria.device('mount')).quarantine.held).toBe(false)
  handControllerMove(fake, mount, { raDegrees: 0, decDegrees: -0.03 })
  await cria.waitFor(state => state.devices[0]!.quarantine.held)
})

function simulatedReadout(detector: ReturnType<typeof makeForeignMotion>, at: number) {
  const property = fake.vector(mount, coordinates)
  return detector.record({ ra: Number(property.elements.RA!.value) * 15, dec: Number(property.elements.DEC!.value), at }, false)
}

it('allows a guided hour with alternating pulses, steady Dec correction and dithers on fake INDI', async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  const detector = makeForeignMotion(0.02)
  detector.tracking(true, 0)
  expect(simulatedReadout(detector, 0)).toBeUndefined()
  for (let second = 1; second <= 3600; second++) {
    // 0.9x sidereal for one second, alternating every second. Dithers alternate 30 arcsec every ten minutes.
    const pulse = (second % 2 ? 1 : -1) * 13.5
    const dither = second % 600 === 0 ? (second % 1200 === 0 ? -30 : 30) : 0
    handControllerMove(fake, mount, { raDegrees: pulse / 3600, decDegrees: (1.3 / 60 + dither) / 3600 })
    expect(simulatedReadout(detector, second * 1000), `guided second ${second}`).toBeUndefined()
  }
})

it('flags a 1x hand-controller move within ten seconds on fake INDI', async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  const detector = makeForeignMotion(0.02)
  detector.tracking(true, 0)
  simulatedReadout(detector, 0)
  for (let second = 1; second <= 4; second++) {
    handControllerMove(fake, mount, { raDegrees: 15 / 3600, decDegrees: 0 })
    expect(simulatedReadout(detector, second * 1000)).toBeUndefined()
  }
  handControllerMove(fake, mount, { raDegrees: 15 / 3600, decDegrees: 0 })
  expect(simulatedReadout(detector, 5000)).toBeDefined()
})

it('flags slow creep past half a degree on fake INDI', async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  const detector = makeForeignMotion(0.02)
  detector.tracking(true, 0)
  simulatedReadout(detector, 0)
  for (let second = 1; second <= 499; second++) {
    handControllerMove(fake, mount, { raDegrees: 0, decDegrees: 0.001 })
    expect(simulatedReadout(detector, second * 1000)).toBeUndefined()
  }
  handControllerMove(fake, mount, { raDegrees: 0, decDegrees: 0.002 })
  expect(simulatedReadout(detector, 500_000)).toBeDefined()
})

it('uses an inclusive sliding window and forgets expired motion', () => {
  const detector = makeForeignMotion(0.02)
  detector.tracking(true, 0)
  detector.record({ ra: 30, dec: 40, at: 0 }, false)
  expect(detector.record({ ra: 30, dec: 40.03, at: 10_001 }, false)).toBeUndefined()
  expect(detector.record({ ra: 30, dec: 40.045, at: 15_000 }, false)).toBeUndefined()
  expect(detector.record({ ra: 30, dec: 40.06, at: 20_001 }, false)).toBeDefined()
})

it('checks every recent baseline and clears both bounds after explained motion and reset', () => {
  const detector = makeForeignMotion(0.02)
  detector.tracking(true, 0)
  detector.record({ ra: 30, dec: 40, at: 0 }, false)
  expect(detector.record({ ra: 30, dec: 39.985, at: 1000 }, false)).toBeUndefined()
  expect(detector.record({ ra: 30, dec: 40.015, at: 2000 }, false)).toBeDefined()
  expect(detector.record({ ra: 30, dec: 41, at: 3000 }, true)).toBeUndefined()
  expect(detector.record({ ra: 30, dec: 41.01, at: 4000 }, false)).toBeUndefined()
  detector.reset()
  expect(detector.record({ ra: 30, dec: 42, at: 5000 }, false)).toBeUndefined()
})
