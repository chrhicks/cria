import { Schema } from 'effect';
import { BindingId, InstanceId } from './ids.js';
import { Timestamp } from './values.js';
export const LeaseId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand('LeaseId'));
export const MountLease = Schema.Struct({
    id: LeaseId,
    holder: Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 128))),
    expiresAt: Timestamp,
});
export const LeaseRequest = Schema.Union([
    Schema.Struct({ action: Schema.Literal('acquire'), instanceId: InstanceId, bindingId: BindingId, holder: MountLease.fields.holder }),
    Schema.Struct({ action: Schema.Literals(['renew', 'release']), instanceId: InstanceId, bindingId: BindingId, leaseId: LeaseId }),
]);
// AM5 profile: 9x reads 3 deg/s (10,800 arcsec/s). A 1 s lease plus
// 50 ms watch cadence adds 11,340 arcsec before abort, plus about 4,084
// arcsec measured stop overshoot. This is a scheduling budget, not a hard
// real-time bound; home/goto can travel faster (home measured 21,783 arcsec/s).
// Renew every 250 ms, leaving three intervals for scheduling and network delay.
export const mountLeaseMs = 1000;
export const mountLeaseRenewMs = 250;
export const mountLeaseWatchMs = 50;
export const needsMountLease = (command) => ['mount-slew', 'mount-axis', 'mount-rotate', 'mount-home', 'mount-park'].includes(command.kind);
//# sourceMappingURL=lease.js.map