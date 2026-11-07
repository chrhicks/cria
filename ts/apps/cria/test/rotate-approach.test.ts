import { afterEach, expect, it } from 'vitest'
import { Schema } from 'effect'
import { FakeIndi, addMount } from '@cria/fake-indi'
import { allReady, startCria, until, type Cria } from './harness.js'

const mount = 'Approach simulator'
const sidereal = 15.041067 / 3600
let fake: FakeIndi
let cria: Cria
let timer: ReturnType<typeof setInterval> | undefined
let speed = 0
let ra = 30
let coastScale = 1
const starts: number[] = []

async function start(tracking = true) {
  speed = 0
  ra = 30
  coastScale = 1
  starts.length = 0
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.update(mount, 'TELESCOPE_TRACK_STATE', { values: { TRACK_ON: tracking, TRACK_OFF: !tracking } })
  const publish = () => fake.update(mount, 'EQUATORIAL_EOD_COORD', { values: { RA: ra / 15 }, state: tracking ? 'Busy' : 'Idle' })
  // Tracking rate motion reports Busy on the AM5, even after the axis has halted.
  timer = setInterval(() => {
    ra += speed + (tracking ? 0 : sidereal)
    publish()
  }, 1000)
  fake.behaviour = (server, vector, values) => {
    if (vector.name !== 'TELESCOPE_MOTION_WE' && vector.name !== 'TELESCOPE_ABORT_MOTION') return
    const direction = vector.name === 'TELESCOPE_ABORT_MOTION' ? 0 : values.MOTION_EAST === 'On' ? 1 : values.MOTION_WEST === 'On' ? -1 : 0
    if (direction === 0) {
      ra += Math.sign(speed) * (Math.abs(speed) > 1 ? 4084 / 3600 : 54 / 3600) * coastScale
      speed = 0
      publish()
      server.update(mount, vector.name, { state: 'Ok', values: vector.name === 'TELESCOPE_MOTION_WE' ? { MOTION_EAST: false, MOTION_WEST: false } : { ABORT: false } })
    } else {
      const rate = Object.values(server.vector(mount, 'TELESCOPE_SLEW_RATE').elements).find(element => element.value === true)
      speed = direction * Number.parseFloat(rate!.label!) * sidereal
      starts.push(speed)
      server.apply(vector, values)
      server.update(mount, vector.name, { state: 'Busy' })
    }
    return 'handled'
  }
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, motion: { positionReadMs: 1100 } }])
  await cria.waitFor(allReady(['mount']))
  // Idle admissions reflect a stationary mount; tracking Busy is emitted once it moves.
  fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Idle' })
}

afterEach(async () => {
  if (timer) clearInterval(timer)
  await cria?.stop()
  await fake?.stop()
})

it.each([23, 11.4, 4, 0.5, -0.5])('lands a %s degree request within 0.3 degrees with one-second readings', async distance => {
  await start(distance < 0)
  const ended = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: Math.sign(distance) * 720 * sidereal, distanceDegrees: distance })
  expect(ended.kind).toBe('confirmed')
  expect(Math.abs(Number(ended.values?.travelledDegrees) - distance)).toBeLessThanOrEqual(0.3)
  expect(ended.operation.motion?.observed.travel?.rightAscensionDegrees).toBe(ended.values?.travelledDegrees)
  expect(starts.at(-1)).toBeCloseTo(Math.sign(distance) * 60 * sidereal)
  expect(starts).toHaveLength(distance > 4.7 ? 2 : 1)
}, 90_000)

for (const phase of [1, 2]) {
  it.each(['cancel', 'stop'] as const)(`%s stops phase ${phase} with tracking on`, async action => {
    await start(true)
    const submitted = await cria.submit('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 23 })
    await until('the selected phase to start', () => starts.length === phase, 60_000)
    if (action === 'cancel') await cria.cancel(submitted.body.id)
    else expect((await cria.run('mount', 'mount-stop', {})).kind).toBe('confirmed')
    expect((await cria.settled(submitted.body.id, 40_000)).kind).toBe('stopped')
    expect(speed).toBe(0)
    expect(starts).toHaveLength(phase)
  }, 90_000)
}


it('adapts to a twenty percent coast change and clamps a run of outliers', async () => {
  await start(false)
  coastScale = 1.2
  const phases = Schema.Struct({ phases: Schema.Array(Schema.Struct({ stopped: Schema.Struct({ reason: Schema.String }) })) })
  const coast = Schema.Struct({ nextCoastDegrees: Schema.Number })
  const rotate = async () => {
    const ended = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 0.05 })
    expect(ended.kind).toBe('confirmed')
    const recorded = Schema.decodeUnknownSync(phases)(JSON.parse(ended.operation.motion!.stopped.reason!))
    return Schema.decodeUnknownSync(coast)(JSON.parse(recorded.phases[0]!.stopped.reason)).nextCoastDegrees
  }
  expect(await rotate()).toBeCloseTo(0.018 + sidereal, 4)
  coastScale = 100
  expect(await rotate()).toBeLessThanOrEqual(0.03)
  for (let i = 0; i < 9; i++) expect(await rotate()).toBeLessThanOrEqual(0.03)
  expect(await rotate()).toBe(0.03)
}, 120_000)

it('ends uncertain with the mount stopped when the fast leg never moves', async () => {
  await start(false)
  const behaviour = fake.behaviour
  fake.behaviour = (server, vector, values) => {
    const answer = behaviour?.(server, vector, values)
    if (vector.name === 'TELESCOPE_MOTION_WE') speed = 0
    return answer
  }
  const ended = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 720 * sidereal, distanceDegrees: 11.4 })
  expect(ended.kind).toBe('uncertain')
  expect(speed).toBe(0)
  expect(starts).toHaveLength(1)
}, 40_000)

it.each([[20, 0.2], [60, 0.2], [20, 0.01], [60, 0.01]])('keeps a %sx request for %s degrees at or below the approach rate in one phase', async (multiple, distance) => {
  await start(true)
  const requested = multiple * sidereal
  const ended = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: requested, distanceDegrees: distance })
  expect(ended.kind).toBe('confirmed')
  expect(starts).toEqual([requested])
  expect(starts.every(rate => Math.abs(rate) <= requested)).toBe(true)
  expect(Math.abs(Number(ended.values?.travelledDegrees) - distance)).toBeLessThanOrEqual(0.1)
  const recorded = Schema.decodeUnknownSync(Schema.Struct({ phases: Schema.Array(Schema.Struct({ commanded: Schema.Struct({ rateDegreesPerSecond: Schema.Number }) })) }))(JSON.parse(ended.operation.motion!.stopped.reason!))
  expect(recorded.phases).toHaveLength(1)
  expect(recorded.phases[0]!.commanded.rateDegreesPerSecond).toBe(requested)
}, 30_000)

it('refuses a near-match advertised rate that would exceed the requested ceiling', async () => {
  await start(true)
  const ended = await cria.run('mount', 'mount-rotate', { rateDegreesPerSecond: 20 * sidereal * 0.995, distanceDegrees: 0.2 })
  expect(ended).toMatchObject({ kind: 'failed', reason: 'invalid' })
  expect(starts).toEqual([])
})
