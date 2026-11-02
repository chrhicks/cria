import { Schema } from 'effect';
export declare const LeaseId: Schema.brand<Schema.String, "LeaseId">;
export type LeaseId = typeof LeaseId.Type;
export declare const MountLease: Schema.Struct<{
    readonly id: Schema.brand<Schema.String, "LeaseId">;
    readonly holder: Schema.String;
    readonly expiresAt: Schema.Number;
}>;
export type MountLease = typeof MountLease.Type;
export declare const LeaseRequest: Schema.Union<readonly [Schema.Struct<{
    readonly action: Schema.Literal<"acquire">;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly holder: Schema.String;
}>, Schema.Struct<{
    readonly action: Schema.Literals<readonly ["renew", "release"]>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly leaseId: Schema.brand<Schema.String, "LeaseId">;
}>]>;
export type LeaseRequest = typeof LeaseRequest.Type;
export declare const mountLeaseMs = 1000;
export declare const mountLeaseRenewMs = 250;
export declare const mountLeaseWatchMs = 50;
export declare const needsMountLease: (command: {
    readonly kind: string;
}) => boolean;
//# sourceMappingURL=lease.d.ts.map