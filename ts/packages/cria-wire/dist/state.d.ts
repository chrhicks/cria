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
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "unavailable", "starting", "disconnected", "stale", "busy"]>;
            readonly message: Schema.String;
        }>]>;
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
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "unavailable", "starting", "disconnected", "stale", "busy"]>;
            readonly message: Schema.String;
        }>]>;
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
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "unavailable", "starting", "disconnected", "stale", "busy"]>;
            readonly message: Schema.String;
        }>]>;
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
        readonly availability: Schema.Union<readonly [Schema.Struct<{
            readonly ready: Schema.Literal<true>;
        }>, Schema.Struct<{
            readonly ready: Schema.Literal<false>;
            readonly reason: Schema.Literals<readonly ["commands-disabled", "unavailable", "starting", "disconnected", "stale", "busy"]>;
            readonly message: Schema.String;
        }>]>;
        readonly kind: Schema.Literal<"box">;
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
        kind: Schema.Literal<"focuser-halt">;
        parameters: Schema.Struct<{}>;
        instanceId: Schema.brand<Schema.String, "InstanceId">;
        requestId: Schema.brand<Schema.String, "RequestId">;
        deviceId: Schema.brand<Schema.String, "DeviceId">;
        id: Schema.brand<Schema.String, "OperationId">;
        acceptedAt: Schema.Number;
        state: Schema.Literal<"waiting">;
    }> | Schema.Struct<{
        kind: Schema.Literal<"mount-stop">;
        parameters: Schema.Struct<{}>;
        instanceId: Schema.brand<Schema.String, "InstanceId">;
        requestId: Schema.brand<Schema.String, "RequestId">;
        deviceId: Schema.brand<Schema.String, "DeviceId">;
        id: Schema.brand<Schema.String, "OperationId">;
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
        }>;
        instanceId: Schema.brand<Schema.String, "InstanceId">;
        requestId: Schema.brand<Schema.String, "RequestId">;
        deviceId: Schema.brand<Schema.String, "DeviceId">;
        id: Schema.brand<Schema.String, "OperationId">;
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
        }>;
        instanceId: Schema.brand<Schema.String, "InstanceId">;
        requestId: Schema.brand<Schema.String, "RequestId">;
        deviceId: Schema.brand<Schema.String, "DeviceId">;
        id: Schema.brand<Schema.String, "OperationId">;
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
    }>)[]>>;
}>;
export type State = typeof State.Type;
export declare const Health: Schema.Struct<{
    readonly status: Schema.Literal<"ok">;
    readonly protocolVersion: Schema.Literal<5>;
}>;
export declare const errorCodes: readonly ['request-error', 'origin-rejected', 'commands-disabled', 'not-found', 'request-conflict', 'instance-changed', 'device-busy', 'result-expired', 'image-gone', 'request-too-large', 'too-many-subscribers', 'internal-error'];
export type ErrorCode = (typeof errorCodes)[number];
export declare const ErrorBody: Schema.Struct<{
    readonly error: Schema.Struct<{
        readonly code: Schema.Literals<readonly ["request-error", "origin-rejected", "commands-disabled", "not-found", "request-conflict", "instance-changed", "device-busy", "result-expired", "image-gone", "request-too-large", "too-many-subscribers", "internal-error"]>;
        readonly message: Schema.String;
    }>;
    readonly instanceId: Schema.NullOr<Schema.brand<Schema.String, "InstanceId">>;
}>;
export type ErrorBody = typeof ErrorBody.Type;
//# sourceMappingURL=state.d.ts.map