/**
 * Discipline: writeOnce. Send a physical command exactly once and classify the
 * device's first answer (decision table in docs/ts/SPEC.md).
 *
 * There is deliberately no retry option. An acknowledged command is not yet a
 * confirmed one: follow it with `confirm` or run it inside `stoppable`.
 */
import { Duration, Effect, Option, Scope } from 'effect';
import { Failed, Uncertain } from '../outcome.js';
/**
 * Uninterruptible on purpose: once the bytes may have left, being cancelled
 * doesn't tell us whether the device acted. The wait is bounded by `within`.
 */
export function writeOnce(write) {
    return Effect.scoped(Effect.gen(function* () {
        const answer = yield* write.listen;
        // The send and the answer share one deadline: a socket that stalls mid-write
        // must not hold a stop or a shutdown forever (review R2 P3a). A send cut off
        // by the deadline may still have left, so it is uncertain too.
        const first = yield* Effect.timeoutOption(Effect.andThen(write.send, answer), write.within);
        if (Option.isNone(first)) {
            return yield* new Uncertain({
                reason: 'no-acknowledgement',
                message: `${write.command}: no answer within ${Duration.format(Duration.fromInputUnsafe(write.within))}`,
            });
        }
        if (first.value.kind === 'rejected')
            return yield* new Failed({ reason: 'rejected', message: `${write.command}: ${first.value.message}` });
        return first.value.ack;
    })).pipe(Effect.uninterruptible);
}
//# sourceMappingURL=write-once.js.map