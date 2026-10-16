import { it } from '@effect/vitest'
import { Effect, Fiber, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect } from 'vitest'
import { Uncertain } from './outcome.js'
import { writeConfirmed } from './discipline/confirm.js'
import { makeRun, type Run, type RunView } from './run.js'
import { stoppable } from './discipline/stoppable.js'

const viewWhere = <P, A>(run: Run<number, P, A>, holds: (view: RunView<P, A>) => boolean) =>
  Effect.map(Stream.runHead(Stream.filter(run.changes, holds)), Option.getOrThrow)

const forkUntilWaiting = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)

    for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow

    return fiber
  })

describe('Run', () => {
  const exposure = (cleanup: string[], stop: 'confirms' | 'fails' = 'confirms') =>
    makeRun({
      initial: { phase: 'preparing' },
      work: (seconds: number, report) =>
        stoppable({
          command: 'EXPOSE',
          start: report({ phase: 'exposing' }),
          settle: Effect.sleep(`${seconds} seconds`).pipe(Effect.as('frame')),
          stop: Effect.gen(function* () {
            yield* Effect.sleep('20 millis')
            if (stop === 'fails') return yield* new Uncertain({ reason: 'not-confirmed', message: 'camera busy' })
            cleanup.push('aborted')
          }),
          stopWithin: '1 second',
        }),
    })
  const exposing = <A>(run: Run<number, { phase: string }, A>) => viewWhere(run, view => view.state === 'running' && view.progress.phase === 'exposing')

  it.effect('refuses a second start while one is active: busy is a fact, not a queue', () =>
    Effect.gen(function* () {
      const run = yield* exposure([])

      yield* run.start('a', 10)
      const second = yield* Effect.flip(run.start('b', 1))

      expect(second).toMatchObject({ reason: 'busy' })
    }))

  it.effect('reports progress while running and the confirmed value when it ends', () =>
    Effect.gen(function* () {
      const run = yield* exposure([])

      yield* run.start('a', 0.02)
      expect(yield* exposing(run)).toMatchObject({ state: 'running', progress: { phase: 'exposing' } })

      yield* TestClock.adjust('20 millis')
      const settled = yield* viewWhere(run, view => view.state === 'settled')

      expect(settled).toMatchObject({ state: 'settled', outcome: { kind: 'confirmed', value: 'frame' } })
    }))

  it.effect('stop returns only after the cleanup confirmed, and settles stopped', () =>
    Effect.gen(function* () {
      const cleanup: string[] = []
      const run = yield* exposure(cleanup)

      yield* run.start('a', 10)
      yield* exposing(run)
      const stopping = yield* forkUntilWaiting(run.stop('a'))

      expect(cleanup).toEqual([])
      yield* TestClock.adjust('20 millis')
      const settled = yield* Fiber.join(stopping)

      expect(cleanup).toEqual(['aborted'])
      expect(settled).toMatchObject({ state: 'settled', outcome: { kind: 'stopped' } })
    }))

  it.effect('a stop that cannot be confirmed settles uncertain, never stopped', () =>
    Effect.gen(function* () {
      const run = yield* exposure([], 'fails')

      yield* run.start('a', 10)
      yield* exposing(run)
      const stopping = yield* forkUntilWaiting(run.stop('a'))

      yield* TestClock.adjust('1 second')

      expect(yield* Fiber.join(stopping)).toMatchObject({
        outcome: { kind: 'uncertain', reason: 'stop-not-confirmed', message: 'EXPOSE: stop was not confirmed within 1s' },
      })
    }))

  it.effect('stopping an execution that already ended does not touch the next one', () =>
    Effect.gen(function* () {
      const run = yield* exposure([])

      yield* run.start('a', 0.001)
      yield* TestClock.adjust('1 millis')
      yield* viewWhere(run, view => view.state === 'settled')
      yield* run.start('b', 10)
      yield* run.stop('a')

      expect(yield* viewWhere(run, () => true)).toMatchObject({ state: 'running', runId: 'b' })
    }))
})

describe('Run: a body that settled wins over a late stop (review R1-#1)', () => {
  it.effect('a stop during a setting reports what the setting did, not "stopped"', () =>
    Effect.gen(function* () {
      let sent = 0
      const run = yield* makeRun({
        initial: {},
        work: () =>
          writeConfirmed(
            {
              command: 'SWITCH',
              within: '1 second',
              listen: Effect.succeed(Effect.sleep('50 millis').pipe(Effect.as({ kind: 'accepted' as const, ack: true }))),
              send: Effect.sync(() => {
                sent += 1
              }),
            },
            () => ({ command: 'SWITCH', read: Effect.succeed(true), holds: Boolean, within: '1 second' }),
          ),
      })

      yield* run.start('a', undefined)
      yield* TestClock.adjust('10 millis')
      expect(sent).toBe(1)
      const stopping = yield* forkUntilWaiting(run.stop('a'))

      yield* TestClock.adjust('40 millis')

      expect(sent).toBe(1)
      expect(yield* Fiber.join(stopping)).toMatchObject({ outcome: { kind: 'confirmed', value: true } })
    }))

  it.effect('a stop after the motion finished, while the body completes, reports confirmed', () =>
    Effect.gen(function* () {
      const run = yield* makeRun({
        initial: {},
        work: () =>
          stoppable({
            command: 'MOVE',
            start: Effect.void,
            settle: Effect.sleep('10 millis'),
            stop: Effect.void,
            stopWithin: '1 second',
          }).pipe(Effect.andThen(Effect.sleep('60 millis')), Effect.as('kept')),
      })

      yield* run.start('a', undefined)
      yield* TestClock.adjust('30 millis')
      const stopping = yield* forkUntilWaiting(run.stop('a'))

      yield* TestClock.adjust('40 millis')

      expect(yield* Fiber.join(stopping)).toMatchObject({ outcome: { kind: 'confirmed', value: 'kept' } })
    }))
})

describe('Run: a stop before the motion starts (review R2 P1-B)', () => {
  it.effect('never starts the motion when the stop arrived during an earlier step', () =>
    Effect.gen(function* () {
      const events: string[] = []
      const run = yield* makeRun({
        initial: {},
        work: () =>
          Effect.sleep('50 millis').pipe(
            Effect.andThen(
              stoppable({
                command: 'MOVE',
                start: Effect.sync(() => void events.push('start')),
                settle: Effect.sleep('1 second'),
                stop: Effect.sync(() => void events.push('stop')),
                stopWithin: '1 second',
              }),
            ),
          ),
      })

      yield* run.start('a', undefined)
      yield* TestClock.adjust('10 millis')
      const stopping = yield* forkUntilWaiting(run.stop('a'))

      yield* TestClock.adjust('40 millis')

      expect(events).toEqual([])
      expect(yield* Fiber.join(stopping)).toMatchObject({ outcome: { kind: 'stopped' } })
    }))
})
