/**
 * Discipline: writeOnce. Send a physical command exactly once and classify the
 * device's first answer (decision table in docs/ts/SPEC.md).
 *
 * There is deliberately no retry option. An acknowledged command is not yet a
 * confirmed one: follow it with `confirm` or run it inside `stoppable`.
 */
import { Duration, Effect, Option, Scope } from 'effect'
import { Failed, Uncertain } from '../outcome.js'

/** The device's first reaction to a sent command. */
export type Answer<Ack> =
  | { readonly kind: 'accepted'; readonly ack: Ack }
  | { readonly kind: 'rejected'; readonly message: string }

export interface WriteOnce<Ack, R> {
  /** Names the command in messages, for example "CCD_EXPOSURE on ZWO CCD ASI2600MC Pro". */
  readonly command: string
  /**
   * Starts listening before the send, so a fast answer can't be missed, and
   * returns the wait for the answer. Fails `Uncertain` if the device goes away
   * while waiting.
   */
  readonly listen: Effect.Effect<Effect.Effect<Answer<Ack>, Uncertain>, never, R | Scope.Scope>
  /** Fails `Failed` only when nothing was sent, `Uncertain` when it may have been. */
  readonly send: Effect.Effect<void, Failed | Uncertain>
  /** How long the device has to answer before the outcome is uncertain. */
  readonly within: Duration.Input
}

/**
 * Uninterruptible on purpose: once the bytes may have left, being cancelled
 * doesn't tell us whether the device acted. The wait is bounded by `within`.
 */
export function writeOnce<Ack, R>(write: WriteOnce<Ack, R>): Effect.Effect<Ack, Failed | Uncertain, Exclude<R, Scope.Scope>> {
  return Effect.scoped(
    Effect.gen(function* () {
      const answer = yield* write.listen
      // The send and the answer share one deadline: a socket that stalls mid-write
      // must not hold a stop or a shutdown forever (review R2 P3a). A send cut off
      // by the deadline may still have left, so it is uncertain too.
      const first = yield* Effect.timeoutOption(Effect.andThen(write.send, answer), write.within)

      if (Option.isNone(first)) {
        return yield* new Uncertain({
          reason: 'no-acknowledgement',
          message: `${write.command}: no answer within ${Duration.format(Duration.fromInputUnsafe(write.within))}`,
        })
      }

      if (first.value.kind === 'rejected')
        return yield* new Failed({ reason: 'rejected', message: `${write.command}: ${first.value.message}` })

      return first.value.ack
    }),
  ).pipe(Effect.uninterruptible)
}
