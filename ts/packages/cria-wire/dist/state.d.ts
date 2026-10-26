/**
 * View: the state snapshot (GET /v2/state, and every SSE `state` event), the
 * small bodies around it, and the protocol version Vela checks.
 */
import { Schema } from 'effect';
export declare const protocolVersion = 5;
export declare const State: Schema.Struct<{
    readonly protocolVersion: Schema.Literal<5>;
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly sequence: Schema.Number;
    readonly generatedAt: Schema.Number;
    readonly commandsEnabled: Schema.Boolean;
    readonly devices: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
        readonly id: Schema.brand<Schema.String, "DeviceId">;
        readonly name: Schema.String;
        readonly bindingId: Schema.brand<Schema.String, "BindingId">;
        readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
            readonly message: Schema.String;
        }>]>;
        readonly quarantine: Schema.Union<readonly [Schema.Struct<{
            readonly held: Schema.Literal<false>;
        }>, Schema.Struct<{
            readonly held: Schema.Literal<true>;
            readonly reason: Schema.String;
            readonly since: Schema.Number;
        }>]>;
        readonly afterOperation: Schema.NullOr<Schema.brand<Schema.String, "OperationId">>;
        readonly kind: Schema.Literal<"camera">;
        readonly readings: Schema.Struct<{
            readonly connected: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly name: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly activity: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Literals<readonly ["idle", "exposing"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Literals<readonly ["idle", "exposing"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly temperatureC: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly setpointC: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly coolerOn: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly coolerPowerPercent: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly sensorWidthPixels: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly sensorHeightPixels: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly pixelWidthMicrons: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly pixelHeightMicrons: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly binX: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly binY: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly width: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly height: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly startX: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly startY: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly maxBinX: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly maxBinY: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly bayerPattern: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Literals<readonly ["mono", "rggb", "grbg", "gbrg", "bggr"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canAbortExposure: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canSetTemperature: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canGetCoolerPower: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly exposureMinimum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly exposureMaximum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly gain: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly gainMinimum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly gainMaximum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly offset: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly offsetMinimum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly offsetMaximum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
        }>;
        readonly lastCommandedSetpointC: Schema.NullOr<Schema.Struct<{
            readonly value: Schema.Number;
            readonly commandedAt: Schema.Number;
        }>>;
    }>, Schema.Struct<{
        readonly id: Schema.brand<Schema.String, "DeviceId">;
        readonly name: Schema.String;
        readonly bindingId: Schema.brand<Schema.String, "BindingId">;
        readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
            readonly message: Schema.String;
        }>]>;
        readonly quarantine: Schema.Union<readonly [Schema.Struct<{
            readonly held: Schema.Literal<false>;
        }>, Schema.Struct<{
            readonly held: Schema.Literal<true>;
            readonly reason: Schema.String;
            readonly since: Schema.Number;
        }>]>;
        readonly afterOperation: Schema.NullOr<Schema.brand<Schema.String, "OperationId">>;
        readonly kind: Schema.Literal<"mount">;
        readonly readings: Schema.Struct<{
            readonly connected: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly name: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly rightAscensionHours: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly declinationDegrees: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly siderealTimeHours: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly slewing: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly tracking: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly parked: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly trackingRate: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Literals<readonly ["sidereal", "lunar", "solar"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Literals<readonly ["sidereal", "lunar", "solar"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly rightAscensionRateSecondsPerSiderealSecond: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly declinationRateArcsecondsPerSecond: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly pierSide: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Literals<readonly ["east", "west", "unknown"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Literals<readonly ["east", "west", "unknown"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly coordinateSystem: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Literals<readonly ["topocentric", "j2000"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Literals<readonly ["topocentric", "j2000"]>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly latitudeDegrees: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly longitudeDegrees: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly elevationMeters: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canSlew: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canSetTracking: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canFindHome: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canPark: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canUnpark: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly canMovePrimaryAxis: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly primaryAxisRates: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.$Array<Schema.Struct<{
                    readonly name: Schema.String;
                    readonly degreesPerSecond: Schema.Number;
                }>>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.$Array<Schema.Struct<{
                    readonly name: Schema.String;
                    readonly degreesPerSecond: Schema.Number;
                }>>;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
        }>;
    }>, Schema.Struct<{
        readonly id: Schema.brand<Schema.String, "DeviceId">;
        readonly name: Schema.String;
        readonly bindingId: Schema.brand<Schema.String, "BindingId">;
        readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
            readonly message: Schema.String;
        }>]>;
        readonly quarantine: Schema.Union<readonly [Schema.Struct<{
            readonly held: Schema.Literal<false>;
        }>, Schema.Struct<{
            readonly held: Schema.Literal<true>;
            readonly reason: Schema.String;
            readonly since: Schema.Number;
        }>]>;
        readonly afterOperation: Schema.NullOr<Schema.brand<Schema.String, "OperationId">>;
        readonly kind: Schema.Literal<"focuser">;
        readonly readings: Schema.Struct<{
            readonly connected: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly name: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly position: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly moving: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly temperatureC: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly absolute: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly minStep: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly maxStep: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
        }>;
    }>, Schema.Struct<{
        readonly id: Schema.brand<Schema.String, "DeviceId">;
        readonly name: Schema.String;
        readonly bindingId: Schema.brand<Schema.String, "BindingId">;
        readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
            readonly message: Schema.String;
        }>]>;
        readonly quarantine: Schema.Union<readonly [Schema.Struct<{
            readonly held: Schema.Literal<false>;
        }>, Schema.Struct<{
            readonly held: Schema.Literal<true>;
            readonly reason: Schema.String;
            readonly since: Schema.Number;
        }>]>;
        readonly afterOperation: Schema.NullOr<Schema.brand<Schema.String, "OperationId">>;
        readonly kind: Schema.Literal<"weather">;
        readonly readings: Schema.Struct<{
            readonly connected: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly name: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly temperatureC: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly humidityPercent: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly dewPointC: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly pressureHpa: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly skyTemperatureC: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly cloudCoverPercent: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly rainRateMmPerHour: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly windSpeedMps: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly windGustMps: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
        }>;
    }>, Schema.Struct<{
        readonly id: Schema.brand<Schema.String, "DeviceId">;
        readonly name: Schema.String;
        readonly bindingId: Schema.brand<Schema.String, "BindingId">;
        readonly failureDomain: Schema.brand<Schema.String, "FailureDomain">;
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
            readonly message: Schema.String;
        }>]>;
        readonly quarantine: Schema.Union<readonly [Schema.Struct<{
            readonly held: Schema.Literal<false>;
        }>, Schema.Struct<{
            readonly held: Schema.Literal<true>;
            readonly reason: Schema.String;
            readonly since: Schema.Number;
        }>]>;
        readonly afterOperation: Schema.NullOr<Schema.brand<Schema.String, "OperationId">>;
        readonly kind: Schema.Literal<"switch">;
        readonly readings: Schema.Struct<{
            readonly connected: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly name: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly channelCount: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
        }>;
        readonly channels: Schema.$Array<Schema.Struct<{
            readonly id: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly name: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.String;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly writable: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly minimum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly maximum: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly step: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly on: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Boolean;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
            readonly value: Schema.Union<readonly [Schema.Struct<{
                readonly status: Schema.Literal<"fresh">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"stale">;
                readonly value: Schema.Number;
                readonly observedAt: Schema.Number;
            }>, Schema.Struct<{
                readonly status: Schema.Literal<"unavailable">;
                readonly reason: Schema.Literals<readonly ["not-read", "unsupported", "failed"]>;
                readonly message: Schema.optionalKey<Schema.String>;
            }>]>;
        }>>;
    }>]>>;
    readonly operations: Schema.$Array<Schema.Union<readonly (Schema.Struct<{
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
            readonly exposureSeconds: Schema.Number;
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
            readonly setpointC: Schema.optionalKey<Schema.Number>;
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
            readonly rateDegreesPerSecond: Schema.Number;
            readonly durationSeconds: Schema.Number;
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
            readonly rateDegreesPerSecond: Schema.Number;
            readonly distanceDegrees: Schema.Number;
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
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
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
            readonly value: Schema.Number;
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
            readonly exposureSeconds: Schema.Number;
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
            readonly setpointC: Schema.optionalKey<Schema.Number>;
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
            readonly rateDegreesPerSecond: Schema.Number;
            readonly durationSeconds: Schema.Number;
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
            readonly rateDegreesPerSecond: Schema.Number;
            readonly distanceDegrees: Schema.Number;
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
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
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
            readonly value: Schema.Number;
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
    }>)[]>>;
}>;
export type State = typeof State.Type;
export declare const Health: Schema.Struct<{
    readonly status: Schema.Literal<"ok">;
    readonly protocolVersion: Schema.Literal<5>;
}>;
export declare const errorCodes: readonly ['request-error', 'unauthorized', 'origin-rejected', 'commands-disabled', 'not-found', 'request-conflict', 'instance-changed', 'binding-changed', 'device-blocked', 'device-busy', 'result-expired', 'image-gone', 'request-too-large', 'too-many-subscribers', 'internal-error'];
export type ErrorCode = (typeof errorCodes)[number];
export declare const ErrorBody: Schema.Struct<{
    readonly error: Schema.Struct<{
        readonly code: Schema.Literals<readonly ["request-error", "unauthorized", "origin-rejected", "commands-disabled", "not-found", "request-conflict", "instance-changed", "binding-changed", "device-blocked", "device-busy", "result-expired", "image-gone", "request-too-large", "too-many-subscribers", "internal-error"]>;
        readonly message: Schema.String;
    }>;
    readonly instanceId: Schema.NullOr<Schema.brand<Schema.String, "InstanceId">>;
}>;
export type ErrorBody = typeof ErrorBody.Type;
export declare const RecoveryRequest: Schema.Struct<{
    readonly instanceId: Schema.brand<Schema.String, "InstanceId">;
    readonly bindingId: Schema.brand<Schema.String, "BindingId">;
    readonly externalRecoveryConfirmed: Schema.Literal<true>;
    readonly note: Schema.String;
}>;
export type RecoveryRequest = typeof RecoveryRequest.Type;
//# sourceMappingURL=state.d.ts.map