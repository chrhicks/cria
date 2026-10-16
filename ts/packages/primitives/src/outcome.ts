/**
 * Primitive: Outcome, the vocabulary of a physical command.
 *
 * Inside Effect code an Outcome is the error channel: the success value is
 * `confirmed`, and `Failed`, `Stopped` and `Uncertain` are tagged errors, so `yield*`
 * unwraps a confirmed result and every other ending travels up until something
 * matches it by tag. At a boundary that must report an ending (a Run, the wire),
 * `settle` turns the Effect into the plain `Outcome` union.
 */
import { Cause, Data, Effect, Exit } from 'effect'

/** Known not to have taken effect. */
export const failedReasons = ['busy', 'blocked', 'disconnected', 'unsupported', 'rejected', 'invalid', 'unavailable'] as const

export type FailedReason = (typeof failedReasons)[number]

/** May have taken effect. Stop, tell a person, never resend. */
export const uncertainReasons = [
  'no-acknowledgement',
  'not-confirmed',
  'stop-not-confirmed',
  'connection-lost',
  'driver-lost',
  'unexpected-error',
] as const

export type UncertainReason = (typeof uncertainReasons)[number]

export class Failed extends Data.TaggedError('Failed')<{
  readonly reason: FailedReason
  readonly message: string
}> {}

/** Cancellation was requested and the device confirmed it stopped. */
export class Stopped extends Data.TaggedError('Stopped')<{}> {}

export class Uncertain extends Data.TaggedError('Uncertain')<{
  readonly reason: UncertainReason
  readonly message: string
}> {}

/** Every way a command can end other than confirmed. */
export type Ending = Failed | Stopped | Uncertain

export type Outcome<A> =
  | { readonly kind: 'confirmed'; readonly value: A }
  | { readonly kind: 'failed'; readonly reason: FailedReason; readonly message: string }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'uncertain'; readonly reason: UncertainReason; readonly message: string }

export const confirmed = <A>(value: A): Outcome<A> => ({ kind: 'confirmed', value })

/**
 * Classify how an Effect ended. When the cause carries several endings (an
 * interrupted run whose stop also failed), the least certain one wins:
 * uncertain > failed > stopped. A defect is uncertain: a bug after a write
 * proves nothing about the equipment.
 */
export function fromExit<A>(exit: Exit.Exit<A, Ending>): Outcome<A> {
  if (Exit.isSuccess(exit)) return confirmed(exit.value)

  const errors = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)
  const uncertain = errors.find(error => error._tag === 'Uncertain')

  if (uncertain) return { kind: 'uncertain', reason: uncertain.reason, message: uncertain.message }

  const defect = exit.cause.reasons.find(Cause.isDieReason)

  if (defect) {
    return {
      kind: 'uncertain',
      reason: 'unexpected-error',
      message: defect.defect instanceof Error ? defect.defect.message : String(defect.defect),
    }
  }

  const failed = errors.find(error => error._tag === 'Failed')

  if (failed) return { kind: 'failed', reason: failed.reason, message: failed.message }

  return { kind: 'stopped' }
}

/** The one sanctioned way to stop an ending from propagating: turn it into a value. */
export function settle<A, R>(effect: Effect.Effect<A, Ending, R>): Effect.Effect<Outcome<A>, never, R> {
  return Effect.exit(effect).pipe(Effect.map(fromExit))
}
