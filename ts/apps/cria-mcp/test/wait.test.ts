import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import type { Operation, OperationId } from '@cria/wire'
import { Cria, CriaLost } from '../src/cria.js'
import { waitFor } from '../src/tools/wait.js'
import { confirmed, decodesAsWire, failed, imageOf, operationId, running } from './fixtures.js'

const id = operationId as OperationId
const stillRunning = decodesAsWire(running)
const done = decodesAsWire(confirmed(imageOf(Buffer.from('frame'))))

const nothing = Effect.die('not used by wait')

/** A Cria whose `operation` answers from `reads`, one per call, and counts the calls. */
const criaReading = (reads: ReadonlyArray<Effect.Effect<Operation, CriaLost>>, took: Duration.Input = 0) => {
  const times: Array<number> = []
  const layer = Layer.succeed(Cria)(
    Cria.of({
      state: nothing,
      request: () => nothing,
      submit: () => nothing,
      cancel: () => nothing,
      recover: () => nothing,
      original: () => nothing,
      operation: () =>
        Effect.gen(function* () {
          times.push(yield* Effect.clockWith(clock => clock.currentTimeMillis))
          yield* Effect.sleep(took)

          return yield* reads[Math.min(times.length, reads.length) - 1]!
        }),
    }),
  )

  return { layer, times }
}

const startAt = Effect.map(Effect.clockWith(clock => clock.currentTimeMillis), now => now)

describe('waitFor, on a clock the test drives', () => {
  it.effect('reads once and returns when the operation is already settled', () =>
    Effect.gen(function* () {
      const { layer, times } = criaReading([Effect.succeed(done)])
      const result = yield* waitFor(id, 45).pipe(Effect.provide(layer))

      expect(result).toEqual(done)
      expect(times).toHaveLength(1)
    }),
  )

  it.effect('reads a second apart and returns the read that settled', () =>
    Effect.gen(function* () {
      const { layer, times } = criaReading([Effect.succeed(stillRunning), Effect.succeed(stillRunning), Effect.succeed(done)])
      const start = yield* startAt
      const fiber = yield* Effect.forkChild(waitFor(id, 45).pipe(Effect.provide(layer)))

      yield* TestClock.adjust('2 seconds')

      expect(yield* Fiber.join(fiber)).toEqual(done)
      expect(times.map(time => time - start)).toEqual([0, 1000, 2000])
    }),
  )

  it.effect('returns the last read, still running, at the deadline and reads no more', () =>
    Effect.gen(function* () {
      const { layer, times } = criaReading([Effect.succeed(stillRunning)])
      const start = yield* startAt
      const fiber = yield* Effect.forkChild(waitFor(id, 3).pipe(Effect.provide(layer)))

      yield* TestClock.adjust('3 seconds')

      expect(yield* Fiber.join(fiber)).toEqual(stillRunning)
      expect(times.map(time => time - start)).toEqual([0, 1000, 2000, 3000])
      yield* TestClock.adjust('10 seconds')
      expect(times).toHaveLength(4)
    }),
  )

  it.effect('measures the deadline from entry, so slow reads shorten the wait and the last one starts at the deadline', () =>
    Effect.gen(function* () {
      const { layer, times } = criaReading([Effect.succeed(stillRunning)], '400 millis')
      const start = yield* startAt
      const fiber = yield* Effect.forkChild(waitFor(id, 2).pipe(Effect.provide(layer)))

      yield* TestClock.adjust('5 seconds')
      yield* Fiber.join(fiber)

      expect(times.map(time => time - start)).toEqual([0, 1400, 2000])
    }),
  )

  it.effect('sleeps less than a second when less than a second is left', () =>
    Effect.gen(function* () {
      const { layer, times } = criaReading([Effect.succeed(stillRunning)])
      const start = yield* startAt
      const fiber = yield* Effect.forkChild(waitFor(id, 1).pipe(Effect.provide(layer)))

      yield* TestClock.adjust('1 second')
      yield* Fiber.join(fiber)

      expect(times.map(time => time - start)).toEqual([0, 1000])
    }),
  )

  it.effect('stops on the first failed read, even with time left', () =>
    Effect.gen(function* () {
      const lost = new CriaLost({ route: 'GET /v2/operations/x', why: 'timeout', message: 'no complete reply' })
      const { layer, times } = criaReading([Effect.succeed(stillRunning), Effect.fail(lost), Effect.succeed(done)])
      const fiber = yield* Effect.forkChild(waitFor(id, 45).pipe(Effect.provide(layer), Effect.flip))

      yield* TestClock.adjust('10 seconds')

      expect(yield* Fiber.join(fiber)).toBe(lost)
      expect(times).toHaveLength(2)
    }),
  )

  it.effect('takes a failed operation as settled', () =>
    Effect.gen(function* () {
      const { layer, times } = criaReading([Effect.succeed(decodesAsWire(failed))])

      expect((yield* waitFor(id, 45).pipe(Effect.provide(layer))).state).toBe('settled')
      expect(times).toHaveLength(1)
    }),
  )
})
