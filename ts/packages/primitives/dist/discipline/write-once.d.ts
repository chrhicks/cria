/**
 * Discipline: writeOnce. Send a physical command exactly once and classify the
 * device's first answer (decision table in docs/ts/SPEC.md).
 *
 * There is deliberately no retry option. An acknowledged command is not yet a
 * confirmed one: follow it with `confirm` or run it inside `stoppable`.
 */
import { Duration, Effect, Scope } from 'effect';
import { Failed, Uncertain } from '../outcome.js';
/** The device's first reaction to a sent command. */
export type Answer<Ack> = {
    readonly kind: 'accepted';
    readonly ack: Ack;
} | {
    readonly kind: 'rejected';
    readonly message: string;
};
export interface WriteOnce<Ack, R> {
    /** Names the command in messages, for example "CCD_EXPOSURE on ZWO CCD ASI2600MC Pro". */
    readonly command: string;
    /**
     * Starts listening before the send, so a fast answer can't be missed, and
     * returns the wait for the answer. Fails `Uncertain` if the device goes away
     * while waiting.
     */
    readonly listen: Effect.Effect<Effect.Effect<Answer<Ack>, Uncertain>, never, R | Scope.Scope>;
    /** Fails `Failed` only when nothing was sent, `Uncertain` when it may have been. */
    readonly send: Effect.Effect<void, Failed | Uncertain>;
    /** How long the device has to answer before the outcome is uncertain. */
    readonly within: Duration.Input;
}
/**
 * Uninterruptible on purpose: once the bytes may have left, being cancelled
 * doesn't tell us whether the device acted. The wait is bounded by `within`.
 */
export declare function writeOnce<Ack, R>(write: WriteOnce<Ack, R>): Effect.Effect<Ack, Failed | Uncertain, Exclude<R, Scope.Scope>>;
//# sourceMappingURL=write-once.d.ts.map