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
import { Cause, Duration, Effect, Exit, Option, Schedule } from 'effect';
import { Failed, Stopped, Uncertain } from '../outcome.js';
export function stoppable(motion) {
    const stopMessage = `stop was not confirmed within ${Duration.format(Duration.fromInputUnsafe(motion.stopWithin))}`;
    // A stop may be sent again until it is confirmed; the motion never is: an abort
    // can only stop motion, never start it (docs/ts/SPEC.md, writeOnce). Paced, and
    // bounded by stopWithin.
    const halt = Effect.exit(Effect.timeoutOption(Effect.retry(motion.stop, Schedule.spaced('500 millis')), motion.stopWithin)).pipe(Effect.map(halted => Exit.isSuccess(halted) && Option.isSome(halted.value)));
    return Effect.uninterruptible(Effect.gen(function* () {
        // A stop that arrived during the steps before this motion (a slew rate,
        // the frame type) is honoured here, before anything moves (review R2 P1-B).
        const cancelled = yield* Effect.exit(Effect.interruptible(Effect.void));
        if (Exit.isFailure(cancelled))
            return yield* new Stopped();
        const started = yield* Effect.exit(motion.start);
        if (Exit.isFailure(started)) {
            const unknown = uncertainIn(started.cause);
            // Refused or never sent: nothing moves. Sent without an answer: it may be moving, so stop it anyway.
            if (!unknown)
                return yield* Effect.failCause(started.cause);
            return yield* (yield* halt) ? unknown : new Uncertain({ reason: unknown.reason, message: `${unknown.message}; ${stopMessage}` });
        }
        // An explicit window, so a Run whose work is uninterruptible can still stop here.
        const settled = yield* Effect.exit(Effect.interruptible(motion.settle));
        if (Exit.isSuccess(settled))
            return settled.value;
        if (!(yield* halt)) {
            // Keep the reason we already knew (the driver vanished), and say the stop failed too.
            const earlier = uncertainIn(settled.cause);
            return yield* new Uncertain(earlier
                ? { reason: earlier.reason, message: `${earlier.message}; ${stopMessage}` }
                : { reason: 'stop-not-confirmed', message: `${motion.command}: ${stopMessage}` });
        }
        if (Cause.hasInterruptsOnly(settled.cause))
            return yield* new Stopped();
        const failed = settled.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error).find(error => error._tag === 'Failed');
        if (failed && !uncertainIn(settled.cause) && (motion.settleFailure ?? 'uncertain') === 'uncertain')
            return yield* new Uncertain({ reason: 'not-confirmed', message: `${motion.command} started but did not complete: ${failed.message}` });
        return yield* Effect.failCause(settled.cause);
    }));
}
function uncertainIn(cause) {
    return cause.reasons.filter(Cause.isFailReason).map(reason => reason.error).find(error => error._tag === 'Uncertain');
}
//# sourceMappingURL=stoppable.js.map