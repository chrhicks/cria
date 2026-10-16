/**
 * Discipline: retryReads. The paced, bounded, cancellable read loop behind
 * every Reading.
 *
 * Each read has its own deadline. A failed read is reported (so values can turn
 * stale) and tried again at the same pace, never faster. The loop runs until
 * its fiber is interrupted.
 */
import { Duration, Effect, Option } from 'effect';
export function retryReads(loop) {
    const once = Effect.gen(function* () {
        const startedAt = Date.now();
        const outcome = yield* Effect.result(Effect.timeoutOption(loop.read, loop.timeout));
        if (outcome._tag === 'Failure')
            return yield* loop.report({ kind: 'failed', error: outcome.failure });
        if (Option.isNone(outcome.success))
            return yield* loop.report({ kind: 'failed', error: 'timeout' });
        yield* loop.report({ kind: 'read', value: outcome.success.value, startedAt });
    });
    return Effect.forever(Effect.andThen(once, Effect.sleep(loop.every)));
}
//# sourceMappingURL=retry-reads.js.map