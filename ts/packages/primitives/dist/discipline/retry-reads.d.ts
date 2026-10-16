/**
 * Discipline: retryReads. The paced, bounded, cancellable read loop behind
 * every Reading.
 *
 * Each read has its own deadline. A failed read is reported (so values can turn
 * stale) and tried again at the same pace, never faster. The loop runs until
 * its fiber is interrupted.
 */
import { Duration, Effect } from 'effect';
export type ReadResult<A, E> = {
    readonly kind: 'read';
    readonly value: A;
    readonly startedAt: number;
} | {
    readonly kind: 'failed';
    readonly error: E | 'timeout';
};
export interface RetryReads<A, E, R> {
    readonly read: Effect.Effect<A, E, R>;
    readonly every: Duration.Input;
    readonly timeout: Duration.Input;
    readonly report: (result: ReadResult<A, E>) => Effect.Effect<void>;
}
export declare function retryReads<A, E, R>(loop: RetryReads<A, E, R>): Effect.Effect<never, never, R>;
//# sourceMappingURL=retry-reads.d.ts.map