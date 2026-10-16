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
import { Effect, Option, Scope, Stream } from 'effect';
import { Failed, type Ending, type Outcome } from './outcome.js';
export type RunView<P, A, Id extends string = string> = {
    readonly state: 'idle';
} | {
    readonly state: 'running';
    readonly runId: Id;
    readonly startedAt: number;
    readonly progress: P;
} | {
    readonly state: 'settled';
    readonly runId: Id;
    readonly startedAt: number;
    readonly settledAt: number;
    readonly progress: P;
    readonly outcome: Outcome<A>;
};
export type SettledView<P, A, Id extends string = string> = Extract<RunView<P, A, Id>, {
    readonly state: 'settled';
}>;
export type Report<P> = (patch: Partial<P>) => Effect.Effect<void>;
export interface RunDefinition<I, P, A> {
    /** Progress at the start of an execution, computed from its input. */
    readonly initial: (input: I) => P;
    readonly work: (input: I, report: Report<P>) => Effect.Effect<A, Ending>;
}
export interface Run<I, P, A, Id extends string = string> {
    readonly changes: Stream.Stream<RunView<P, A, Id>>;
    /** Fails `busy` while another execution is active. */
    readonly start: (runId: Id, input: I) => Effect.Effect<void, Failed>;
    /** The current view. */
    readonly view: Effect.Effect<RunView<P, A, Id>>;
    /**
     * Interrupts that execution and returns its settled view, or `none` when the
     * run ID is not the active (latest) one.
     */
    readonly stop: (runId: Id) => Effect.Effect<Option.Option<SettledView<P, A, Id>>>;
    /**
     * Waits until that execution settles and returns its settled view without
     * stopping it, or `none` when the run ID is neither the latest execution nor
     * the one before it.
     */
    readonly await: (runId: Id) => Effect.Effect<Option.Option<SettledView<P, A, Id>>>;
}
export declare function makeRun<I, P, A, Id extends string = string>(definition: RunDefinition<I, P, A>): Effect.Effect<Run<I, P, A, Id>, never, Scope.Scope>;
//# sourceMappingURL=run.d.ts.map