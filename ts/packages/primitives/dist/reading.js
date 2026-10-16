/**
 * Primitive: Reading, a device value with its age.
 *
 * A stale Reading keeps its last value and when it was observed, so a consumer
 * can show "last known" honestly; a consumer can't get at `value` without first
 * deciding what to do when the Reading is not fresh.
 */
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
//# sourceMappingURL=reading.js.map