/**
 * Discipline: stoppable. Run something that moves or exposes so that a cancel
 * always ends with the device confirmed stationary, or with an honest
 * `uncertain`.
 *
 * Only `settle` (waiting for the motion or exposure to finish) can be
 * interrupted. If it is interrupted, or fails while the device is in motion,
 * `stop` runs uninterruptibly with its own deadline and must confirm the device
 * stopped. A stop that fails (indiserver unreachable, no acknowledgement) is
 * tried again every 500 ms until that deadline: halting is always safe to
 * repeat, unlike the motion itself, which is never resent.
 */
import { Duration, Effect } from 'effect';
import { Failed, Uncertain, type Ending } from '../outcome.js';
export interface Stoppable<A, R> {
    readonly command: string;
    /**
     * Begins the motion: normally a `writeOnce`. Not interruptible. If it ends
     * uncertain (sent, no answer), the stop still runs: the device may be moving.
     */
    readonly start: Effect.Effect<void, Failed | Uncertain, R>;
    /** Waits for the motion to finish. The only interruptible part. */
    readonly settle: Effect.Effect<A, Failed | Uncertain, R>;
    /** Halts the motion and confirms the device is stationary. */
    readonly stop: Effect.Effect<void, Failed | Uncertain, R>;
    readonly stopWithin: Duration.Input;
    /**
     * What a settle failure becomes once the stop is confirmed. Default
     * 'uncertain': the motion started, so the device moved by an unknown amount
     * ("failed" means known not to have taken effect). 'failed' only where a
     * confirmed stop leaves nothing changed that matters (a camera exposure).
     */
    readonly settleFailure?: 'uncertain' | 'failed';
}
export declare function stoppable<A, R>(motion: Stoppable<A, R>): Effect.Effect<A, Ending, R>;
//# sourceMappingURL=stoppable.d.ts.map