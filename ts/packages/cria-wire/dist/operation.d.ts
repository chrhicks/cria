/**
 * View: an operation and the request that admits it. An operation is
 * `waiting` (a halt queued behind the operation it stops; only halts wait),
 * `running` once started, and `settled` once its Outcome is known. Each state
 * carries only the fields it has. Vela matches `state`, then `outcome.kind`.
 */
import { Schema } from 'effect';
export declare const Image: Schema.Struct<{
    readonly id: Schema.brand<Schema.String, "ImageId">;
    readonly operationId: Schema.brand<Schema.String, "OperationId">;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly cameraName: Schema.String;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly width: Schema.Number;
    readonly height: Schema.Number;
    readonly binX: Schema.Number;
    readonly binY: Schema.Number;
    readonly startX: Schema.Number;
    readonly startY: Schema.Number;
    readonly exposureSeconds: Schema.Number;
    readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
    readonly capturedAt: Schema.Number;
    readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
    readonly retainedAt: Schema.Number;
    readonly sha256: Schema.String;
    readonly original: Schema.Struct<{
        readonly mediaType: Schema.Literal<"application/imagebytes">;
        readonly bytes: Schema.Number;
        readonly url: Schema.String;
    }>;
}>;
export type Image = typeof Image.Type;
export declare const OperationResult: Schema.Struct<{
    readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
    readonly image: Schema.NullOr<Schema.Struct<{
        readonly id: Schema.brand<Schema.String, "ImageId">;
        readonly operationId: Schema.brand<Schema.String, "OperationId">;
        readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
        readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
        readonly cameraName: Schema.String;
        readonly bindingId: Schema.brand<Schema.String, "BindingId">;
        readonly width: Schema.Number;
        readonly height: Schema.Number;
        readonly binX: Schema.Number;
        readonly binY: Schema.Number;
        readonly startX: Schema.Number;
        readonly startY: Schema.Number;
        readonly exposureSeconds: Schema.Number;
        readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
        readonly capturedAt: Schema.Number;
        readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
        readonly retainedAt: Schema.Number;
        readonly sha256: Schema.String;
        readonly original: Schema.Struct<{
            readonly mediaType: Schema.Literal<"application/imagebytes">;
            readonly bytes: Schema.Number;
            readonly url: Schema.String;
        }>;
    }>>;
}>;
export type OperationResult = typeof OperationResult.Type;
/** The five fields that identify a request to a device, shared by `OperationRequest` and every operation state. */
export declare const requestIdentity: {
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    bindingId: Schema.brand<Schema.String, "BindingId">;
    expectedName: Schema.String;
};
/** What Vela sends: its identity for the request, then one command, flat. */
export declare const OperationRequest: Schema.Union<Schema.Struct<{
    readonly kind: Schema.Literal<"camera-configure">;
    readonly parameters: Schema.Struct<{
        readonly binX: Schema.optionalKey<Schema.Number>;
        readonly binY: Schema.optionalKey<Schema.Number>;
        readonly startX: Schema.optionalKey<Schema.Number>;
        readonly startY: Schema.optionalKey<Schema.Number>;
        readonly width: Schema.optionalKey<Schema.Number>;
        readonly height: Schema.optionalKey<Schema.Number>;
        readonly gain: Schema.optionalKey<Schema.Number>;
        readonly offset: Schema.optionalKey<Schema.Number>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"capture">;
    readonly parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Finite;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"cooling">;
    readonly parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Finite>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"device-connect">;
    readonly parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"focuser-halt">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"focuser-move">;
    readonly parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-axis">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly durationSeconds: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-home">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-park">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-rotate">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly distanceDegrees: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-slew">;
    readonly parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Finite;
        readonly declinationDegrees: Schema.Finite;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-stop">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-tracking">;
    readonly parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"mount-unpark">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
} | {
    readonly kind: Schema.Literal<"switch-set">;
    readonly parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
}>[]>;
export type OperationRequest = typeof OperationRequest.Type;
export declare const Progress: Schema.Struct<{
    readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
    readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
}>;
export type Progress = typeof Progress.Type;
export declare const Operation: Schema.Union<readonly (Schema.Struct<{
    readonly kind: Schema.Literal<"focuser-halt">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"waiting">;
} | {
    readonly kind: Schema.Literal<"mount-stop">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"waiting">;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"camera-configure">;
    readonly parameters: Schema.Struct<{
        readonly binX: Schema.optionalKey<Schema.Number>;
        readonly binY: Schema.optionalKey<Schema.Number>;
        readonly startX: Schema.optionalKey<Schema.Number>;
        readonly startY: Schema.optionalKey<Schema.Number>;
        readonly width: Schema.optionalKey<Schema.Number>;
        readonly height: Schema.optionalKey<Schema.Number>;
        readonly gain: Schema.optionalKey<Schema.Number>;
        readonly offset: Schema.optionalKey<Schema.Number>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"capture">;
    readonly parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Finite;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"cooling">;
    readonly parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Finite>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"device-connect">;
    readonly parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"focuser-halt">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"focuser-move">;
    readonly parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-axis">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly durationSeconds: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-home">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-park">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-rotate">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly distanceDegrees: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-slew">;
    readonly parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Finite;
        readonly declinationDegrees: Schema.Finite;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-stop">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-tracking">;
    readonly parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"mount-unpark">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
} | {
    readonly kind: Schema.Literal<"switch-set">;
    readonly parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"running">;
    readonly startedAt: Schema.Number;
    readonly progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"camera-configure">;
    readonly parameters: Schema.Struct<{
        readonly binX: Schema.optionalKey<Schema.Number>;
        readonly binY: Schema.optionalKey<Schema.Number>;
        readonly startX: Schema.optionalKey<Schema.Number>;
        readonly startY: Schema.optionalKey<Schema.Number>;
        readonly width: Schema.optionalKey<Schema.Number>;
        readonly height: Schema.optionalKey<Schema.Number>;
        readonly gain: Schema.optionalKey<Schema.Number>;
        readonly offset: Schema.optionalKey<Schema.Number>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"capture">;
    readonly parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Finite;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"cooling">;
    readonly parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Finite>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"device-connect">;
    readonly parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"focuser-halt">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"focuser-move">;
    readonly parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-axis">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly durationSeconds: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-home">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-park">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-rotate">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly distanceDegrees: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-slew">;
    readonly parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Finite;
        readonly declinationDegrees: Schema.Finite;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-stop">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-tracking">;
    readonly parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"mount-unpark">;
    readonly parameters: Schema.Struct<{}>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
} | {
    readonly kind: Schema.Literal<"switch-set">;
    readonly parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Finite;
    }>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly requestId: Schema.brand<Schema.String, "RequestId">;
    readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly expectedName: Schema.String;
    readonly id: Schema.brand<Schema.String, "OperationId">;
    readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    readonly acceptedAt: Schema.Number;
    readonly state: Schema.Literal<"settled">;
    readonly startedAt: Schema.Number;
    readonly settledAt: Schema.Number;
    readonly outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly bindingId: Schema.brand<Schema.String, "BindingId">;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
                readonly binX: Schema.Number;
                readonly binY: Schema.Number;
                readonly startX: Schema.Number;
                readonly startY: Schema.Number;
                readonly exposureSeconds: Schema.Number;
                readonly color: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly capturedAt: Schema.Number;
                readonly capturedAtSource: Schema.Literals<readonly ["camera", "server-estimate"]>;
                readonly retainedAt: Schema.Number;
                readonly sha256: Schema.String;
                readonly original: Schema.Struct<{
                    readonly mediaType: Schema.Literal<"application/imagebytes">;
                    readonly bytes: Schema.Number;
                    readonly url: Schema.String;
                }>;
            }>>;
        }>;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"failed">;
        readonly reason: Schema.Literals<readonly ["busy", "blocked", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    readonly recovery: Schema.NullOr<Schema.Struct<{
        readonly at: Schema.Number;
        readonly note: Schema.String;
    }>>;
}>)[]>;
export type Operation = typeof Operation.Type;
//# sourceMappingURL=operation.d.ts.map