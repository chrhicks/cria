/**
 * Discipline: confirm. After an acknowledged write, read until the device shows
 * the target state or the deadline passes.
 *
 * Reads are safe to repeat; the write is never repeated. Reaching the deadline
 * means the command was sent and we can't see that it worked: `uncertain`.
 */
import { Duration, Effect, type Scope } from 'effect';
import { type Failed, Uncertain } from '../outcome.js';
import { type WriteOnce } from './write-once.js';
export interface Confirm<A, E, R> {
    readonly command: string;
    /** One read of the device state. A failed read is tried again at `every`. */
    readonly read: Effect.Effect<A, E, R>;
    readonly holds: (observed: A) => boolean;
    readonly within: Duration.Input;
    readonly every?: Duration.Input;
}
export declare function confirm<A, E, R>(check: Confirm<A, E, R>): Effect.Effect<A, Uncertain, R>;
/**
 * A setting: write once, then confirm by readback, as one uninterruptible step.
 * Inside a Run this is belt and braces (the Run's work is uninterruptible); it
 * matters when a setting runs on its own.
 */
export declare function writeConfirmed<Ack, RW, A, E, R>(write: WriteOnce<Ack, RW>, check: (ack: Ack) => Confirm<A, E, R>): Effect.Effect<A, Failed | Uncertain, Exclude<RW, Scope.Scope> | R>;
//# sourceMappingURL=confirm.d.ts.map