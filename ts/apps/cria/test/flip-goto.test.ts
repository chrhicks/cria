import { expect, it } from 'vitest'
import type { MountEnvelope } from '@cria/wire'
import { FakeIndi, addMount } from '@cria/fake-indi'
import { allReady, startCria, type Cria } from './harness.js'
import { measuredEnvelope, splitEnvelope, wideEnvelope } from './envelope-fixtures.js'
import { recordedGotos, type RecordedGoto } from './goto-fixtures.js'
import type { MountPose } from '../src/capability/goto-reach.js'

const normalFlip = recordedGotos.flips.find(flip => flip.from.declinationDegrees < 89 && flip.from.hourAngleDegrees < 0)
if (normalFlip === undefined) throw new Error('Missing recorded normal-to-normal flip')

const pose = (hourAngleDegrees: number, declinationDegrees: number, pierSide: MountPose['pierSide']): MountPose => ({ hourAngleDegrees, declinationDegrees, pierSide })
const syntheticFlip: RecordedGoto = {
  from: pose(-40, 50, 'west'), target: pose(40, 50, 'east'),
  poses: [
    pose(-40, 50, 'west'), pose(-46, 56, 'west'), pose(-52, 62, 'west'), pose(-58, 68, 'west'),
    pose(-64, 74, 'west'), pose(-70, 80, 'west'), pose(-76, 86, 'west'), pose(98, 88, 'east'),
    pose(92, 82, 'east'), pose(86, 76, 'east'), pose(80, 70, 'east'), pose(74, 64, 'east'),
    pose(68, 58, 'east'), pose(62, 52, 'east'), pose(56, 50, 'east'), pose(50, 50, 'east'),
    pose(44, 50, 'east'), pose(40, 50, 'east'),
  ],
}

async function replay({ motion, envelope, tracking, meridianLimit = 15 }: { readonly motion: RecordedGoto; readonly envelope: MountEnvelope; readonly tracking: boolean; readonly meridianLimit?: number }) {
  const fake = new FakeIndi()
  await fake.start()
  const mount = 'Fake Mount'
  addMount(fake, mount)
  const ra = (ha: number) => ((-ha + 360) % 360) / 15
  fake.define({ device: mount, name: 'TELESCOPE_PIER_SIDE', kind: 'switch', perm: 'ro', state: 'Ok', elements: { PIER_WEST: { value: motion.from.pierSide === 'west' }, PIER_EAST: { value: motion.from.pierSide === 'east' } } })
  fake.define({ device: mount, name: 'TIME_LST', kind: 'number', perm: 'ro', state: 'Ok', elements: { LST: { value: 0 } } })
  fake.define({ device: mount, name: 'MERIDIAN_LIMIT', kind: 'number', perm: 'rw', state: 'Ok', elements: { LIMIT: { value: meridianLimit } } })
  fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Ok', values: { RA: ra(motion.from.hourAngleDegrees), DEC: motion.from.declinationDegrees } })
  fake.update(mount, 'TELESCOPE_TRACK_STATE', { values: { TRACK_ON: tracking, TRACK_OFF: !tracking } })
  const timers: ReturnType<typeof setTimeout>[] = []
  const stops: MountPose[] = []
  let lastPose = motion.from
  fake.behaviour = (server, vector) => {
    if (vector.name === 'TELESCOPE_ABORT_MOTION') {
      stops.push(lastPose)
      timers.forEach(clearTimeout)
      server.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Ok' })
      return 'default'
    }
    if (vector.name !== 'EQUATORIAL_EOD_COORD') return 'default'
    server.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Busy' })
    motion.poses.forEach((point, index) => timers.push(setTimeout(() => {
      lastPose = point
      server.update(mount, 'TELESCOPE_PIER_SIDE', { values: { PIER_WEST: point.pierSide === 'west', PIER_EAST: point.pierSide === 'east' } })
      server.update(mount, 'EQUATORIAL_EOD_COORD', { state: index === motion.poses.length - 1 ? 'Ok' : 'Busy', values: { RA: ra(point.hourAngleDegrees), DEC: point.declinationDegrees } })
    }, (index + 1) * 100)))
    return 'handled'
  }
  let cria: Cria | undefined
  try {
    cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, envelope, motion: { positionReadMs: 250 } }])
    await cria.waitFor(allReady(['mount']))
    if (meridianLimit === 5) {
      const { instanceId } = await cria.state()
      expect((await cria.client.fix('mount', { instanceId, fix: { capturedAt: Date.now(), rightAscensionDegrees: ra(motion.from.hourAngleDegrees) * 15, declinationDegrees: motion.from.declinationDegrees, coordinateSystem: 'j2000', pointingErrorArcmin: 1, error: { scaleError: 0, hintOffsetDegrees: 0 } } })).status).toBe(200)
    }
    fake.received.length = 0
    const result = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: ra(motion.target.hourAngleDegrees) * 15, declinationDegrees: motion.target.declinationDegrees, coordinateSystem: 'topocentric' })
    return { result, sent: fake.received.filter(xml => xml.startsWith('<new')), device: await cria.device('mount'), stoppedAt: stops[0] }
  } finally {
    timers.forEach(clearTimeout)
    await cria?.stop()
    await fake.stop()
  }
}

it.each([false, true])('replays the recorded normal flip without a representation-jump abort while tracking is %s', async tracking => {
  const { result, sent, device } = await replay({ motion: normalFlip, envelope: wideEnvelope, tracking })
  expect(result.kind, result.message ?? '').toBe('confirmed')
  expect(result.operation.motion?.stopped.how).toBe('arrived')
  expect(result.quarantined).toBe(false)
  expect(sent.some(xml => xml.includes('EQUATORIAL_EOD_COORD'))).toBe(true)
  expect(sent.some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(false)
}, 15_000)

it('keeps the live watch when the recorded path reaches the stricter low band', async () => {
  const { result, sent, stoppedAt } = await replay({ motion: normalFlip, envelope: splitEnvelope, tracking: true })
  expect(result.kind, result.message ?? '').toBe('uncertain')
  expect(result.message).toContain('west HA limit 91')
  expect(result.operation.motion?.stopped.how).toBe('aborted')
  expect(sent.some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(true)
  const firstAfterFlip = normalFlip.poses.find(point => point.pierSide !== normalFlip.from.pierSide)
  if (stoppedAt === undefined || firstAfterFlip === undefined) throw new Error('Expected a recorded post-fold stop')
  expect(stoppedAt.declinationDegrees).toBeLessThan(firstAfterFlip.declinationDegrees)
}, 15_000)

it('completes a synthetic clear normal flip through the strict split bands', async () => {
  const { result, sent, device } = await replay({ motion: syntheticFlip, envelope: splitEnvelope, tracking: true })
  expect(result.kind, result.message ?? '').toBe('confirmed')
  expect(result.operation.motion?.stopped.how).toBe('arrived')
  expect(sent.some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(false)
}, 15_000)

it.each([80, 89.5])('checks the folded endpoint reserve before a synthetic approach to Dec %s', async dec => {
  const motion = { from: pose(-30, 50, 'west'), target: pose(-30, dec, 'west'), poses: [50, 56, 62, 68, 74, dec].map(point => pose(-30, point, 'west')) }
  const envelope = dec === 80 ? splitEnvelope : { ...splitEnvelope, keepOut: splitEnvelope.keepOut.map(band => band.name === 'normal near pole' ? { ...band, eastHourAngleDegrees: -115, westHourAngleDegrees: 115 } : band) }
  const { result, sent } = await replay({ motion, envelope, tracking: true })
  if (dec === 80) {
    expect(result.kind, result.message ?? '').toBe('confirmed')
    expect(result.operation.motion?.stopped.how).toBe('arrived')
  } else {
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' })
    expect(result.message).toContain('115')
    expect(sent).toEqual([])
  }
}, 15_000)


it.each([false, true])('replays a recorded near-meridian goto without an abort while tracking is %s', async tracking => {
  const motion = recordedGotos.flips.find(goto => Math.abs(goto.target.hourAngleDegrees + 2.1) < 0.2)
  if (motion === undefined) throw new Error('Missing recorded near-meridian goto')
  const { result, sent } = await replay({ motion, envelope: measuredEnvelope, tracking, meridianLimit: 5 })
  expect(result.kind, result.message ?? '').toBe('confirmed')
  expect(result.operation.motion?.stopped.how).toBe('arrived')
  expect(sent.some(xml => xml.includes('TELESCOPE_ABORT_MOTION'))).toBe(false)
}, 15_000)
