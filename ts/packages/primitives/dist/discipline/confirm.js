/**
 * Discipline: confirm. After an acknowledged write, read until the device shows
 * the target state or the deadline passes.
 *
 * Reads are safe to repeat; the write is never repeated. Reaching the deadline
 * means the command was sent and we can't see that it worked: `uncertain`.
 */
import { Duration, Effect, Option } from 'effect';
import { Uncertain } from '../outcome.js';
import { writeOnce } from './write-once.js';
export function confirm(check) {
    const every = check.every ?? '100 millis';
    const attempt = Effect.gen(function* () {
        while (true) {
            const observed = yield* Effect.option(check.read);
            if (Option.isSome(observed) && check.holds(observed.value))
                return observed.value;
            yield* Effect.sleep(every);
        }
    });
    return Effect.timeoutOption(attempt, check.within).pipe(Effect.flatMap(result => Option.match(result, {
        onSome: Effect.succeed,
        onNone: () => Effect.fail(new Uncertain({
            reason: 'not-confirmed',
            message: `${check.command}: the device did not show the requested state within ${Duration.format(Duration.fromInputUnsafe(check.within))}`,
        })),
    })));
}
/**
 * A setting: write once, then confirm by readback, as one uninterruptible step.
 * Inside a Run this is belt and braces (the Run's work is uninterruptible); it
 * matters when a setting runs on its own.
 */
export function writeConfirmed(write, check) {
    return Effect.uninterruptible(Effect.flatMap(writeOnce(write), ack => confirm(check(ack))));
}
//# sourceMappingURL=confirm.js.map