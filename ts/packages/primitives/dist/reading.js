/**
 * Primitive: Reading, a device value with its age.
 *
 * A stale Reading keeps its last value and when it was observed, so a consumer
 * can show "last known" honestly; a consumer can't get at `value` without first
 * deciding what to do when the Reading is not fresh.
 */
import { Effect } from 'effect';
import { Failed } from './outcome.js';
export const unavailableReasons = ['not-read', 'unsupported', 'failed'];
export const fresh = (value, observedAt) => ({
    status: 'fresh',
    value,
    observedAt,
});
export const stale = (value, observedAt) => ({
    status: 'stale',
    value,
    observedAt,
});
export function unavailable(reason, message) {
    return message === undefined ? { status: 'unavailable', reason } : { status: 'unavailable', reason, message };
}
export function map(reading, f) {
    if (reading.status === 'unavailable')
        return reading;
    return { ...reading, value: f(reading.value) };
}
/** Combine Readings that describe one fact: fresh only if all are, observed at the oldest. */
export function both(a, b, f) {
    if (a.status === 'unavailable')
        return a;
    if (b.status === 'unavailable')
        return b;
    const value = f(a.value, b.value);
    const observedAt = Math.min(a.observedAt, b.observedAt);
    return a.status === 'fresh' && b.status === 'fresh' ? fresh(value, observedAt) : stale(value, observedAt);
}
/**
 * A fact a command needs: fresh, or the command fails before sending. A stale
 * or not-read Reading fails `unavailable`; one the device does not support fails
 * `unsupported`. `what` names the fact in the message.
 */
export function required(reading, what) {
    if (reading.status === 'fresh')
        return Effect.succeed(reading.value);
    if (reading.status === 'unavailable' && reading.reason === 'unsupported')
        return Effect.fail(new Failed({ reason: 'unsupported', message: `${what} is not supported by this device` }));
    return Effect.fail(new Failed({ reason: 'unavailable', message: `${what} is not currently known` }));
}
//# sourceMappingURL=reading.js.map