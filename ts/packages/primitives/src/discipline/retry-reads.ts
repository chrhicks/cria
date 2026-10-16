/**
 * Discipline: retryReads. The paced, bounded, cancellable read loop behind
 * every Reading.
 *
 * Each read has its own deadline. A failed read is reported (so values can turn
 * stale) and tried again at the same pace, never faster. The loop runs until
 * its fiber is interrupted.
 */
import { Duration, Effect, Option } from 'effect'

export type ReadResult<A, E> =
  | { readonly kind: 'read'; readonly value: A; readonly startedAt: number }
  | { readonly kind: 'failed'; readonly error: E | 'timeout' }

export interface RetryReads<A, E, R> {
  readonly read: Effect.Effect<A, E, R>
  readonly every: Duration.Input
  readonly timeout: Duration.Input
  readonly report: (result: ReadResult<A, E>) => Effect.Effect<void>
}

export function retryReads<A, E, R>(loop: RetryReads<A, E, R>): Effect.Effect<never, never, R> {
  const once = Effect.gen(function* () {
    const startedAt = Date.now()
    const outcome = yield* Effect.result(Effect.timeoutOption(loop.read, loop.timeout))

    if (outcome._tag === 'Failure')
      return yield* loop.report({ kind: 'failed', error: outcome.failure })

    if (Option.isNone(outcome.success))
      return yield* loop.report({ kind: 'failed', error: 'timeout' })

    yield* loop.report({ kind: 'read', value: outcome.success.value, startedAt })
  })

  return Effect.forever(Effect.andThen(once, Effect.sleep(loop.every)))
}
