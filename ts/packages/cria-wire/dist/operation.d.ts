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
    readonly width: Schema.Number;
    readonly height: Schema.Number;
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
        readonly width: Schema.Number;
        readonly height: Schema.Number;
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
/** The three fields that identify a request to a device, shared by `OperationRequest` and every operation state. */
export declare const requestIdentity: {
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
};
export declare const OperationRequest: Schema.Union<(Schema.Struct<{
    kind: Schema.Literal<"camera-configure">;
    parameters: Schema.Struct<{
        readonly gain: Schema.optionalKey<Schema.Number>;
        readonly offset: Schema.optionalKey<Schema.Number>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"capture">;
    parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Finite;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"cooling">;
    parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Finite>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"device-connect">;
    parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"focuser-halt">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"focuser-move">;
    parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-axis">;
    parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly durationSeconds: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-home">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-rotate">;
    parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly distanceDegrees: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-slew">;
    parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Finite;
        readonly declinationDegrees: Schema.Finite;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-stop">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-tracking">;
    parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}> | Schema.Struct<{
    kind: Schema.Literal<"switch-set">;
    parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
}>)[]>;
export type OperationRequest = typeof OperationRequest.Type;
export declare const Progress: Schema.Struct<{
    readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
    readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
}>;
export type Progress = typeof Progress.Type;
export declare const Operation: Schema.Union<readonly (Schema.Struct<{
    kind: Schema.Literal<"focuser-halt">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"waiting">;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-stop">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"waiting">;
}> | Schema.Struct<{
    kind: Schema.Literal<"camera-configure">;
    parameters: Schema.Struct<{
        readonly gain: Schema.optionalKey<Schema.Number>;
        readonly offset: Schema.optionalKey<Schema.Number>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"capture">;
    parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Finite;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"cooling">;
    parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Finite>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"device-connect">;
    parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"focuser-halt">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"focuser-move">;
    parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-axis">;
    parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly durationSeconds: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-home">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-rotate">;
    parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly distanceDegrees: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-slew">;
    parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Finite;
        readonly declinationDegrees: Schema.Finite;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-stop">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-tracking">;
    parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"switch-set">;
    parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"running">;
    startedAt: Schema.Number;
    progress: Schema.Struct<{
        readonly phase: Schema.Literals<readonly ["preparing", "exposing", "readout", "retaining"]>;
        readonly elapsedSeconds: Schema.NullOr<Schema.Number>;
    }>;
}> | Schema.Struct<{
    kind: Schema.Literal<"camera-configure">;
    parameters: Schema.Struct<{
        readonly gain: Schema.optionalKey<Schema.Number>;
        readonly offset: Schema.optionalKey<Schema.Number>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"capture">;
    parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Finite;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"cooling">;
    parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Finite>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"device-connect">;
    parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"focuser-halt">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"focuser-move">;
    parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-axis">;
    parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly durationSeconds: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-home">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-rotate">;
    parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Finite;
        readonly distanceDegrees: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-slew">;
    parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Finite;
        readonly declinationDegrees: Schema.Finite;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-stop">;
    parameters: Schema.Struct<{}>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"mount-tracking">;
    parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}> | Schema.Struct<{
    kind: Schema.Literal<"switch-set">;
    parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Finite;
    }>;
    instanceId: Schema.brand<Schema.String, "InstanceId">;
    requestId: Schema.brand<Schema.String, "RequestId">;
    deviceId: Schema.brand<Schema.String, "DeviceId">;
    id: Schema.brand<Schema.String, "OperationId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    acceptedAt: Schema.Number;
    state: Schema.Literal<"settled">;
    startedAt: Schema.Number;
    settledAt: Schema.Number;
    outcome: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literal<"confirmed">;
        readonly value: Schema.Struct<{
            readonly values: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.Number, Schema.Boolean, Schema.Null]>>;
            readonly image: Schema.NullOr<Schema.Struct<{
                readonly id: Schema.brand<Schema.String, "ImageId">;
                readonly operationId: Schema.brand<Schema.String, "OperationId">;
                readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
                readonly deviceId: Schema.brand<Schema.String, "DeviceId">;
                readonly cameraName: Schema.String;
                readonly width: Schema.Number;
                readonly height: Schema.Number;
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
        readonly reason: Schema.Literals<readonly ["busy", "disconnected", "unsupported", "rejected", "invalid", "unavailable"]>;
        readonly message: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"stopped">;
    }>, Schema.Struct<{
        readonly kind: Schema.Literal<"uncertain">;
        readonly reason: Schema.Literals<readonly ["no-acknowledgement", "not-confirmed", "stop-not-confirmed", "connection-lost", "driver-lost", "unexpected-error"]>;
        readonly message: Schema.String;
    }>]>;
    /** Present on a mount motion whose command was sent, whatever its outcome. */
    motion: Schema.optionalKey<Schema.Struct<{
        readonly commanded: Schema.Union<readonly [Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literal<"slew">;
            readonly target: Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"axis">;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly axis: Schema.Literal<"ra">;
            readonly rateDegreesPerSecond: Schema.Number;
            readonly kind: Schema.Literal<"rotate">;
            readonly distanceDegrees: Schema.Number;
        }>, Schema.Struct<{
            readonly sentAt: Schema.Number;
            readonly kind: Schema.Literals<readonly ["home", "stop"]>;
        }>]>;
        readonly observed: Schema.Struct<{
            readonly from: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly to: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
            readonly travel: Schema.NullOr<Schema.Struct<{
                readonly rightAscensionDegrees: Schema.Number;
                readonly declinationDegrees: Schema.Number;
            }>>;
        }>;
        readonly stopped: Schema.Struct<{
            readonly how: Schema.Literals<readonly ["arrived", "halted", "aborted", "uncertain"]>;
            readonly reason: Schema.optionalKey<Schema.String>;
            readonly at: Schema.NullOr<Schema.Number>;
        }>;
    }>>;
}>)[]>;
export type Operation = typeof Operation.Type;
//# sourceMappingURL=operation.d.ts.map