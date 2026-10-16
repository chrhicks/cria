/**
 * Primitive: Reading, a device value with its age.
 *
 * A stale Reading keeps its last value and when it was observed, so a consumer
 * can show "last known" honestly; a consumer can't get at `value` without first
 * deciding what to do when the Reading is not fresh.
 */
import { Effect } from 'effect';
import { Failed } from './outcome.js';
export declare const unavailableReasons: readonly ['not-read', 'unsupported', 'failed'];
export type UnavailableReason = (typeof unavailableReasons)[number];
export type Reading<T> = {
    readonly status: 'fresh';
    readonly value: T;
    readonly observedAt: number;
} | {
    readonly status: 'stale';
    readonly value: T;
    readonly observedAt: number;
} | {
    readonly status: 'unavailable';
    readonly reason: UnavailableReason;
    readonly message?: string;
};
export declare const fresh: <T>(value: T, observedAt: number) => Reading<T>;
export declare const stale: <T>(value: T, observedAt: number) => Reading<T>;
export declare function unavailable<T = never>(reason: UnavailableReason, message?: string): Reading<T>;
export declare function map<T, U>(reading: Reading<T>, f: (value: T) => U): Reading<U>;
/** Combine Readings that describe one fact: fresh only if all are, observed at the oldest. */
export declare function both<A, B, C>(a: Reading<A>, b: Reading<B>, f: (a: A, b: B) => C): Reading<C>;
/**
 * A fact a command needs: fresh, or the command fails before sending. A stale
 * or not-read Reading fails `unavailable`; one the device does not support fails
 * `unsupported`. `what` names the fact in the message.
 */
export declare function required<T>(reading: Reading<T>, what: string): Effect.Effect<T, Failed>;
//# sourceMappingURL=reading.d.ts.map