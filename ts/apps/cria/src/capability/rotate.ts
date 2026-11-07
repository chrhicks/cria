import { Effect, Option } from 'effect'
import { Failed, type Ending } from '@cria/primitives'
import type { MotionCommanded, MotionLeg } from '@cria/wire'
import type { MountMotionSettings } from '../config.js'
import { invalid } from './context.js'
import type { Note } from './motion-record.js'
import { advertisedRate, type AxisRate, type AxisTravel } from './mount.js'
import { angularDelta } from './stopped.js'

type AxisMotion = (
  rateDegreesPerSecond: number,
  until: (travelled: Effect.Effect<number, Failed>) => Effect.Effect<void, Failed>,
  commanded: (rateDegreesPerSecond: number, sentAt: number) => MotionCommanded,
  note: Note,
  continuing?: boolean,
) => Effect.Effect<AxisTravel, Ending>

interface Start {
  readonly rates: ReadonlyArray<AxisRate>
  readonly rightAscensionDegrees: number
  readonly declinationDegrees: number
}

export function makeCoastEstimator(stopLatencyMs: number) {
  const coastSamples = new Map<string, number[]>()
  const seedCoast = (speed: number) => Math.abs(speed - 3.008) < 0.031 ? 4084 / 3600
    : Math.abs(speed - 0.2507) < 0.003 ? 54 / 3600 : speed * stopLatencyMs / 1000

  return {
    expected: (rate: AxisRate) => {
      const seed = seedCoast(rate.degreesPerSecond)
      const samples = [...(coastSamples.get(rate.name) ?? [])].sort((a, b) => a - b)
      const middle = Math.floor(samples.length / 2)
      const median = samples.length === 0 ? seed : samples.length % 2 === 0
        ? (samples[middle - 1]! + samples[middle]!) / 2 : samples[middle]!
      return Math.max(seed * 0.5, Math.min(seed * 2, median))
    },
    learn: (rate: AxisRate, coastDegrees: number) =>
      void coastSamples.set(rate.name, [...(coastSamples.get(rate.name) ?? []), coastDegrees].slice(-9)),
  }
}

export function makeRotate(mount: { readonly prepare: Effect.Effect<Start, Ending>; readonly axisMotion: AxisMotion; readonly motion: MountMotionSettings }) {
  const coast = makeCoastEstimator(mount.motion.stopLatencyMs)
  const expectedCoast = coast.expected

  return (rateDegreesPerSecond: number, distanceDegrees: number, note: Note) => Effect.gen(function* () {
    if (Math.sign(rateDegreesPerSecond) !== Math.sign(distanceDegrees))
      return yield* invalid('The rate and the distance point in opposite directions')
    const start = yield* mount.prepare
    const fast = advertisedRate(start.rates, Math.abs(rateDegreesPerSecond))
    if (fast === undefined || fast.degreesPerSecond > Math.abs(rateDegreesPerSecond))
      return yield* invalid('The mount does not offer the requested axis rate without exceeding it')
    const approach = [...start.rates].filter(rate => rate.degreesPerSecond >= 0.1).sort((a, b) => a.degreesPerSecond - b.degreesPerSecond)[0]
    if (approach === undefined) return yield* invalid('The mount offers no approach rate of at least 0.1°/s')
    const slow = fast.degreesPerSecond <= approach.degreesPerSecond ? fast : approach
    const origin = start.rightAscensionDegrees
    const originDec = start.declinationDegrees
    const direction = Math.sign(distanceDegrees)
    const distance = Math.abs(distanceDegrees)
    const legs: MotionLeg[] = []
    let commanded: MotionCommanded | undefined
    const recordLeg = (rate: AxisRate): Note => record => Effect.gen(function* () {
      commanded ??= { kind: 'rotate', sentAt: record.commanded.sentAt, axis: 'ra', rateDegreesPerSecond, distanceDegrees }
      if (record.stopped.how !== 'uncertain') {
        legs.push(record)
        if (record.coastDegrees !== undefined) coast.learn(rate, record.coastDegrees)
      }
      const to = record.observed.to
      yield* note({
        ...record,
        commanded,
        observed: { ...record.observed, from: { rightAscensionDegrees: origin, declinationDegrees: originDec }, travel: to === null ? null : {
          rightAscensionDegrees: angularDelta(to.rightAscensionDegrees, origin),
          declinationDegrees: to.declinationDegrees - originDec,
        } },
        legs: [...legs],
      })
    })
    let travelled = 0
    let end = origin
    let finalRate = slow.name
    const runLeg = (rate: AxisRate, remaining: number, fastLeg: boolean) => mount.axisMotion(
      direction * rate.degreesPerSecond,
      travel => Effect.gen(function* () {
        while (true) {
          const along = (yield* travel) * direction
          if (along < -1) return yield* new Failed({ reason: 'rejected', message: 'The axis moved opposite to the requested RA travel' })
          const lead = fastLeg ? expectedCoast(rate) + rate.degreesPerSecond * mount.motion.positionReadMs / 1000 + 0.25 : expectedCoast(rate)
          if (along >= remaining - lead) return
          yield* Effect.sleep('50 millis')
        }
      }).pipe(
        Effect.timeoutOption(Math.min(120, remaining / rate.degreesPerSecond * 2 + 2) * 1000),
        Effect.flatMap(Option.match({ onSome: () => Effect.void,
          onNone: () => Effect.fail(new Failed({ reason: 'unavailable', message: 'The requested RA travel was not reached in time' })),
        })),
      ),
      (speed, sentAt) => ({ kind: 'rotate', sentAt, axis: 'ra', rateDegreesPerSecond: speed, distanceDegrees: direction * remaining }),
      recordLeg(rate),
      legs.length > 0,
    )
    const window = expectedCoast(fast) + fast.degreesPerSecond * mount.motion.positionReadMs / 1000 + 0.25
    if (distance > window && fast.degreesPerSecond > slow.degreesPerSecond) {
      const result = yield* runLeg(fast, distance, true)
      travelled = result.travelledDegrees
      end = result.rightAscensionDegrees
      finalRate = result.rate
    }
    const remaining = distance - travelled * direction
    if (fast.degreesPerSecond <= approach.degreesPerSecond || remaining >= expectedCoast(slow)) {
      const result = yield* runLeg(slow, remaining, false)
      end = result.rightAscensionDegrees
      finalRate = result.rate
    }
    return { rightAscensionDegrees: end, rate: finalRate, travelledDegrees: angularDelta(end, origin) }
  }).pipe(Effect.scoped)
}
