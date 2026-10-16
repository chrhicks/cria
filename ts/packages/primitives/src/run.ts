/**
 * Primitive: Run, an ephemeral, observable, cancellable workflow execution.
 *
 * A Run owns what every controller used to hand-roll: single flight (a second
 * start while one is active fails `busy`, it is not queued), the fiber, progress
 * reports, stop, and the settled Outcome. `stop` interrupts the work and
 * returns only once the work has settled, so "stopped" is reported after the
 * cleanup the work's disciplines performed, never before.
 *
 * The work is uninterruptible except inside `stoppable`'s wait, the only place
 * where cancelling means something physical (abort, then confirm stationary).
 * A stop that arrives anywhere else lets the body finish and reports what it
 * actually did; a body that completed is never reported as stopped.
 */
import { Deferred, Effect, Fiber, Option, Ref, Scope, Semaphore, Stream, SubscriptionRef } from 'effect'
import { Failed, fromExit, type Ending, type Outcome } from './outcome.js'

export type RunView<P, A, Id extends string = string> =
  | { readonly state: 'idle' }
  | {
      readonly state: 'running'
      readonly runId: Id
      readonly startedAt: number
      readonly progress: P
    }
  | {
      readonly state: 'settled'
      readonly runId: Id
      readonly startedAt: number
      readonly settledAt: number
      readonly progress: P
      readonly outcome: Outcome<A>
    }

export type SettledView<P, A, Id extends string = string> = Extract<RunView<P, A, Id>, { readonly state: 'settled' }>

export type Report<P> = (patch: Partial<P>) => Effect.Effect<void>

export interface RunDefinition<I, P, A> {
  /** Progress at the start of an execution, computed from its input. */
  readonly initial: (input: I) => P
  readonly work: (input: I, report: Report<P>) => Effect.Effect<A, Ending>
}

export interface Run<I, P, A, Id extends string = string> {
  readonly changes: Stream.Stream<RunView<P, A, Id>>
  /** Fails `busy` while another execution is active. */
  readonly start: (runId: Id, input: I) => Effect.Effect<void, Failed>
  /** The current view. */
  readonly view: Effect.Effect<RunView<P, A, Id>>
  /**
   * Interrupts that execution and returns its settled view, or `none` when the
   * run ID is not the active (latest) one.
   */
  readonly stop: (runId: Id) => Effect.Effect<Option.Option<SettledView<P, A, Id>>>
  /**
   * Waits until that execution settles and returns its settled view without
   * stopping it, or `none` when the run ID is neither the latest execution nor
   * the one before it.
   */
  readonly await: (runId: Id) => Effect.Effect<Option.Option<SettledView<P, A, Id>>>
}

interface Active<P, A, Id extends string> {
  readonly runId: Id
  readonly fiber: Fiber.Fiber<void>
  readonly done: Deferred.Deferred<SettledView<P, A, Id>>
}

export function makeRun<I, P, A, Id extends string = string>(definition: RunDefinition<I, P, A>): Effect.Effect<Run<I, P, A, Id>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const view = yield* SubscriptionRef.make<RunView<P, A, Id>>({ state: 'idle' })
    const active = yield* Ref.make<Active<P, A, Id> | undefined>(undefined)
    // The execution before the active one, which has settled: start fails busy until it has.
    const previous = yield* Ref.make<Active<P, A, Id> | undefined>(undefined)
    const transition = yield* Semaphore.make(1)

    const report = (runId: Id): Report<P> => patch =>
      SubscriptionRef.update(view, current =>
        current.state === 'running' && current.runId === runId
          ? { ...current, progress: { ...current.progress, ...patch } }
          : current,
      )

    const finish = (runId: Id, done: Deferred.Deferred<SettledView<P, A, Id>>, outcome: Outcome<A>) =>
      Effect.gen(function* () {
        const settled = yield* SubscriptionRef.modify(view, current => {
          if (current.state !== 'running' || current.runId !== runId) return [undefined, current] as const

          const next: SettledView<P, A, Id> = { ...current, state: 'settled', settledAt: Date.now(), outcome }

          return [next, next] as const
        })

        if (settled) yield* Deferred.succeed(done, settled)
      })

    const start = (runId: Id, input: I) =>
      transition.withPermit(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(view)

          if (current.state === 'running')
            return yield* new Failed({ reason: 'busy', message: `Busy with ${current.runId}` })

          yield* SubscriptionRef.set(view, {
            state: 'running',
            runId,
            startedAt: Date.now(),
            progress: definition.initial(input),
          })

          const done = yield* Deferred.make<SettledView<P, A, Id>>()
          // The work runs uninterruptibly: a stop only acts where a discipline
          // opens a window for it (stoppable's wait). The outcome is taken from
          // the body's own exit inside that region, so a body that settled wins
          // over a stop that arrived late; the fiber's exit would only say
          // "interrupted" and lose it.
          const execution = Effect.exit(definition.work(input, report(runId))).pipe(
            Effect.flatMap(exit => finish(runId, done, fromExit(exit))),
          )
          const fiber = yield* Effect.forkIn(execution, scope, { uninterruptible: true })

          yield* Ref.set(previous, yield* Ref.get(active))
          yield* Ref.set(active, { runId, fiber, done })
        }),
      )

    const stop = (runId: Id) =>
      Effect.gen(function* () {
        const running = yield* Ref.get(active)

        if (running?.runId !== runId) return Option.none()

        yield* Fiber.interrupt(running.fiber)

        // Interrupted before its body began: nothing ran, so it stopped.
        if (!(yield* Deferred.isDone(running.done))) yield* finish(runId, running.done, { kind: 'stopped' })

        return Option.some(yield* Deferred.await(running.done))
      })

    const settledView = (runId: Id) =>
      Effect.gen(function* () {
        const known = [yield* Ref.get(active), yield* Ref.get(previous)].find(execution => execution?.runId === runId)

        return known ? Option.some(yield* Deferred.await(known.done)) : Option.none()
      })

    return {
      changes: SubscriptionRef.changes(view),
      view: SubscriptionRef.get(view),
      start,
      stop,
      await: settledView,
    }
  })
}
