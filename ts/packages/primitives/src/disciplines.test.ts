import { it } from '@effect/vitest'
import { Effect, Fiber, Ref, type Duration } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect } from 'vitest'
import { Failed, Uncertain, fromExit, settle } from './outcome.js'
import { writeOnce, type Answer } from './discipline/write-once.js'
import { confirm, writeConfirmed } from './discipline/confirm.js'
import { stoppable } from './discipline/stoppable.js'
import { retryReads, type ReadResult } from './discipline/retry-reads.js'

const forkUntilWaiting = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)

    for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow

    return fiber
  })

const after = <A, E>(duration: Duration.Input, effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* forkUntilWaiting(effect)

    yield* TestClock.adjust(duration)

    return yield* Fiber.join(fiber)
  })

/** A device that answers a command the way it is told to, and counts what it was sent. */
function fakeDevice(reply: 'ok' | 'alert' | 'silent', delayMs = 5) {
  let sent = 0

  const write = {
    command: 'TEST_PROPERTY',
    within: '50 millis',
    listen: Effect.succeed(
      reply === 'silent'
        ? Effect.never
        : Effect.sleep(delayMs).pipe(
            Effect.as<Answer<string>>(
              reply === 'ok' ? { kind: 'accepted', ack: 'Ok' } : { kind: 'rejected', message: 'out of range' },
            ),
          ),
    ),
    send: Effect.sync(() => {
      sent += 1
    }),
  }

  return { write, sent: () => sent }
}

describe('writeOnce', () => {
  it.effect('returns the acknowledgement when the device accepts', () =>
    Effect.gen(function* () {
      const device = fakeDevice('ok')

      expect(yield* after('5 millis', writeOnce(device.write))).toBe('Ok')
      expect(device.sent()).toBe(1)
    }))

  it.effect('reports rejected, not uncertain, when the device refuses at once', () =>
    Effect.gen(function* () {
      const device = fakeDevice('alert')

      expect(yield* after('5 millis', settle(writeOnce(device.write)))).toMatchObject({ kind: 'failed', reason: 'rejected' })
    }))

  it.effect('is uncertain when the device never answers, and sends exactly once', () =>
    Effect.gen(function* () {
      const device = fakeDevice('silent')

      expect(yield* after('50 millis', settle(writeOnce(device.write)))).toMatchObject({ kind: 'uncertain', reason: 'no-acknowledgement' })
      expect(device.sent()).toBe(1)
    }))

  it.effect('is uncertain, within its deadline, when the send itself stalls (R2 P3a)', () =>
    Effect.gen(function* () {
      const device = fakeDevice('ok')

      expect(yield* after('50 millis', settle(writeOnce({ ...device.write, send: Effect.never })))).toMatchObject({
        kind: 'uncertain',
        reason: 'no-acknowledgement',
      })
    }))

  it.effect('reports failed when nothing could be sent', () =>
    Effect.gen(function* () {
      const device = fakeDevice('ok')
      const write = { ...device.write, send: Effect.fail(new Failed({ reason: 'unavailable', message: 'down' })) }

      expect(yield* after('5 millis', settle(writeOnce(write)))).toMatchObject({ kind: 'failed', reason: 'unavailable' })
    }))

  it.effect('cannot be cancelled once sent: a cancel during the wait returns only once the device answered', () =>
    Effect.gen(function* () {
      const device = fakeDevice('ok', 30)
      const writing = yield* forkUntilWaiting(writeOnce(device.write))

      yield* TestClock.adjust('5 millis')
      let interrupted = false
      const interrupting = yield* forkUntilWaiting(Fiber.interrupt(writing).pipe(Effect.tap(() => Effect.sync(() => void (interrupted = true)))))

      expect(interrupted).toBe(false)
      yield* TestClock.adjust('25 millis')
      yield* Fiber.join(interrupting)

      expect([interrupted, device.sent()]).toEqual([true, 1])
    }))
})

describe('confirm', () => {
  it.effect('confirms once the readback shows the target, retrying failed reads', () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0)
      const read = Ref.updateAndGet(reads, n => n + 1).pipe(Effect.flatMap(n => (n < 3 ? Effect.fail('read error' as const) : Effect.succeed(n))))

      expect(yield* after('10 millis', confirm({ command: 'TEST', read, holds: n => n >= 4, within: '1 second', every: '1 millis' }))).toBe(4)
    }))

  it.effect('is uncertain when the readback never shows the target', () =>
    Effect.gen(function* () {
      const outcome = yield* after('30 millis', settle(confirm({ command: 'TEST', read: Effect.succeed(false), holds: Boolean, within: '30 millis' })))

      expect(outcome).toMatchObject({ kind: 'uncertain', reason: 'not-confirmed' })
    }))

  it.effect('writeConfirmed is not stopped by a cancel between write and readback', () =>
    Effect.gen(function* () {
      const device = fakeDevice('ok', 1)
      const fiber = yield* forkUntilWaiting(
        writeConfirmed(device.write, () => ({
          command: 'TEST',
          read: Effect.succeed(true),
          holds: Boolean,
          within: '1 second',
          every: '20 millis',
        })).pipe(Effect.delay('1 millis')),
      )

      yield* TestClock.adjust('10 millis')
      yield* Fiber.interrupt(fiber)

      expect(device.sent()).toBe(1)
    }))
})

describe('stoppable', () => {
  function motion(stop: 'confirms' | 'fails' | 'hangs') {
    const events: string[] = []

    const effect = stoppable({
      command: 'MOVE',
      start: Effect.sync(() => {
        events.push('start')
      }),
      settle: Effect.sleep('1 second').pipe(Effect.as('arrived')),
      stop: Effect.gen(function* () {
        events.push('stop')
        yield* Effect.sleep('10 millis')
        if (stop === 'fails') return yield* new Uncertain({ reason: 'not-confirmed', message: 'still moving' })
        if (stop === 'hangs') return yield* Effect.never
        events.push('stationary')
      }),
      stopWithin: '50 millis',
    })

    return { effect, events }
  }

  const cancelAfterStart = (stop: 'confirms' | 'fails' | 'hangs') =>
    Effect.gen(function* () {
      const run = motion(stop)
      const fiber = yield* forkUntilWaiting(run.effect)

      yield* TestClock.adjust('10 millis')
      yield* after('50 millis', Fiber.interrupt(fiber))

      return { outcome: fromExit(yield* Fiber.await(fiber)), events: run.events }
    })

  it.effect('a cancel stops the motion and waits for stationary before ending', () =>
    Effect.gen(function* () {
      const { events, outcome } = yield* cancelAfterStart('confirms')

      expect(events).toEqual(['start', 'stop', 'stationary'])
      expect(outcome).toEqual({ kind: 'stopped' })
    }))

  it.effect('a stop that fails leaves the outcome uncertain, not stopped', () =>
    Effect.gen(function* () {
      const { outcome } = yield* cancelAfterStart('fails')

      expect(outcome).toEqual({ kind: 'uncertain', reason: 'stop-not-confirmed', message: 'MOVE: stop was not confirmed within 50ms' })
    }))

  it.effect('a stop that hangs is uncertain at its own deadline', () =>
    Effect.gen(function* () {
      const { outcome } = yield* cancelAfterStart('hangs')

      expect(outcome).toEqual({ kind: 'uncertain', reason: 'stop-not-confirmed', message: 'MOVE: stop was not confirmed within 50ms' })
    }))

  it.effect('when the device was already lost, keeps that reason and adds that the stop failed', () =>
    Effect.gen(function* () {
      const outcome = yield* after(
        '50 millis',
        settle(
          stoppable({
            command: 'MOVE',
            start: Effect.void,
            settle: Effect.fail(new Uncertain({ reason: 'driver-lost', message: 'the focuser went away' })),
            stop: Effect.fail(new Uncertain({ reason: 'connection-lost', message: 'gone' })),
            stopWithin: '50 millis',
          }),
        ),
      )

      expect(outcome).toEqual({ kind: 'uncertain', reason: 'driver-lost', message: 'the focuser went away; stop was not confirmed within 50ms' })
    }))

  it.effect('a start that may have taken effect still gets the stop, and stays uncertain (R1-#4)', () =>
    Effect.gen(function* () {
      const events: string[] = []
      const outcome = yield* settle(
        stoppable({
          command: 'MOVE',
          start: Effect.fail(new Uncertain({ reason: 'no-acknowledgement', message: 'no answer' })),
          settle: Effect.sync(() => void events.push('settle')),
          stop: Effect.sync(() => void events.push('stop')),
          stopWithin: '50 millis',
        }),
      )

      expect(outcome).toEqual({ kind: 'uncertain', reason: 'no-acknowledgement', message: 'no answer' })
      expect(events).toEqual(['stop'])
    }))

  it.effect('a settle failure after the start stops the motion and is uncertain: it moved (R1-#5)', () =>
    Effect.gen(function* () {
      const events: string[] = []
      const motion = (settleFailure?: 'failed') =>
        stoppable({
          command: 'MOVE',
          start: Effect.void,
          settle: Effect.fail(new Failed({ reason: 'rejected', message: 'deadline passed' })),
          stop: Effect.sync(() => void events.push('stop')),
          stopWithin: '50 millis',
          ...(settleFailure ? { settleFailure } : {}),
        })

      expect(yield* settle(motion())).toEqual({ kind: 'uncertain', reason: 'not-confirmed', message: 'MOVE started but did not complete: deadline passed' })
      expect(yield* settle(motion('failed'))).toEqual({ kind: 'failed', reason: 'rejected', message: 'deadline passed' })
      expect(events).toEqual(['stop', 'stop'])
    }))
})

describe('retryReads', () => {
  it.effect('reports a read that overruns its deadline as failed, at the same pace', () =>
    Effect.gen(function* () {
      const results: Array<ReadResult<number, never>> = []
      let calls = 0

      const loop = retryReads({
        read: Effect.suspend(() => {
          calls += 1

          return calls === 2 ? Effect.never : Effect.succeed(calls)
        }),
        every: '5 millis',
        timeout: '20 millis',
        report: result => Effect.sync(() => void results.push(result)),
      })

      yield* after('80 millis', Effect.timeoutOption(loop, '80 millis'))

      expect(results.map(result => (result.kind === 'read' ? result.value : result.error))).toEqual([1, 'timeout', 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    }))
})
