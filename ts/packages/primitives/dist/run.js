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
import { Deferred, Effect, Fiber, Ref, Scope, Semaphore, Stream, SubscriptionRef } from 'effect';
import { Failed, fromExit } from './outcome.js';
export function makeRun(definition) {
    return Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const view = yield* SubscriptionRef.make({ state: 'idle' });
        const active = yield* Ref.make(undefined);
        const transition = yield* Semaphore.make(1);
        const report = (runId) => patch => SubscriptionRef.update(view, current => current.state === 'running' && current.runId === runId
            ? { ...current, progress: { ...current.progress, ...patch } }
            : current);
        const finish = (runId, done, outcome) => Effect.gen(function* () {
            const settled = yield* SubscriptionRef.modify(view, current => {
                if (current.state !== 'running' || current.runId !== runId)
                    return [current, current];
                const next = { ...current, state: 'settled', settledAt: Date.now(), outcome };
                return [next, next];
            });
            yield* Deferred.succeed(done, settled);
        });
        const start = (runId, input) => transition.withPermit(Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(view);
            if (current.state === 'running')
                return yield* new Failed({ reason: 'busy', message: `Busy with ${current.runId}` });
            yield* SubscriptionRef.set(view, {
                state: 'running',
                runId,
                startedAt: Date.now(),
                progress: definition.initial,
            });
            const done = yield* Deferred.make();
            // The work runs uninterruptibly: a stop only acts where a discipline
            // opens a window for it (stoppable's wait). The outcome is taken from
            // the body's own exit inside that region, so a body that settled wins
            // over a stop that arrived late; the fiber's exit would only say
            // "interrupted" and lose it.
            const execution = Effect.exit(definition.work(input, report(runId))).pipe(Effect.flatMap(exit => finish(runId, done, fromExit(exit))));
            const fiber = yield* Effect.forkIn(execution, scope, { uninterruptible: true });
            yield* Ref.set(active, { runId, fiber, done });
        }));
        const stop = (runId) => Effect.gen(function* () {
            const running = yield* Ref.get(active);
            if (running?.runId !== runId)
                return yield* SubscriptionRef.get(view);
            yield* Fiber.interrupt(running.fiber);
            // Interrupted before its body began: nothing ran, so it stopped.
            if (!(yield* Deferred.isDone(running.done)))
                yield* finish(runId, running.done, { kind: 'stopped' });
            return yield* Deferred.await(running.done);
        });
        return {
            changes: SubscriptionRef.changes(view),
            start,
            stop,
        };
    });
}
//# sourceMappingURL=run.js.map