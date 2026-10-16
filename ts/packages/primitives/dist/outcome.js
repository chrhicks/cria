/**
 * Primitive: Outcome, the vocabulary of a physical command.
 *
 * Inside Effect code an Outcome is the error channel: the success value is
 * `confirmed`, and `Failed`, `Stopped` and `Uncertain` are tagged errors, so `yield*`
 * unwraps a confirmed result and every other ending travels up until something
 * matches it by tag. At a boundary that must report an ending (a Run, the wire),
 * `settle` turns the Effect into the plain `Outcome` union.
 */
import { Cause, Data, Effect, Exit } from 'effect';
/** Known not to have taken effect. */
export const failedReasons = ['busy', 'blocked', 'disconnected', 'unsupported', 'rejected', 'invalid', 'unavailable'];
/** May have taken effect. Stop, tell a person, never resend. */
export const uncertainReasons = [
    'no-acknowledgement',
    'not-confirmed',
    'stop-not-confirmed',
    'connection-lost',
    'driver-lost',
    'unexpected-error',
];
export class Failed extends Data.TaggedError('Failed') {
}
/** Cancellation was requested and the device confirmed it stopped. */
export class Stopped extends Data.TaggedError('Stopped') {
}
export class Uncertain extends Data.TaggedError('Uncertain') {
}
export const confirmed = (value) => ({ kind: 'confirmed', value });
/**
 * Classify how an Effect ended. When the cause carries several endings (an
 * interrupted run whose stop also failed), the least certain one wins:
 * uncertain > failed > stopped. A defect is uncertain: a bug after a write
 * proves nothing about the equipment.
 */
export function fromExit(exit) {
    if (Exit.isSuccess(exit))
        return confirmed(exit.value);
    const errors = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
    const uncertain = errors.find(error => error._tag === 'Uncertain');
    if (uncertain)
        return { kind: 'uncertain', reason: uncertain.reason, message: uncertain.message };
    const defect = exit.cause.reasons.find(Cause.isDieReason);
    if (defect) {
        return {
            kind: 'uncertain',
            reason: 'unexpected-error',
            message: defect.defect instanceof Error ? defect.defect.message : String(defect.defect),
        };
    }
    const failed = errors.find(error => error._tag === 'Failed');
    if (failed)
        return { kind: 'failed', reason: failed.reason, message: failed.message };
    return { kind: 'stopped' };
}
/** The one sanctioned way to stop an ending from propagating: turn it into a value. */
export function settle(effect) {
    return Effect.exit(effect).pipe(Effect.map(fromExit));
}
//# sourceMappingURL=outcome.js.map