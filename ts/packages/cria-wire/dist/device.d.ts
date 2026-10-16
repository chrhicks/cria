/**
 * View: a device, one shape per kind so every reading has a typed value.
 * Values are named (`'east'`, `'sidereal'`), not ASCOM integers.
 */
import { Schema } from 'effect';
export declare const deviceKinds: readonly ['camera', 'mount', 'focuser', 'weather', 'switch'];
export type DeviceKind = (typeof deviceKinds)[number];
export declare const coordinateFrames: readonly ['topocentric', 'j2000'];
export declare const availabilityReasons: readonly ['commands-disabled', 'blocked', 'unavailable', 'starting', 'disconnected', 'stale', 'busy', 'refreshing'];
export declare const Availability: Schema.Union<readonly [Schema.Struct<{
    readonly ready: Schema.Literal<true>;
}>, Schema.Struct<{
    readonly ready: Schema.Literal<false>;
    readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
    readonly message: Schema.String;
}>]>;
export declare const Quarantine: Schema.Union<readonly [Schema.Struct<{
    readonly held: Schema.Literal<false>;
}>, Schema.Struct<{
    readonly held: Schema.Literal<true>;
    readonly reason: Schema.String;
    readonly since: Schema.Number;
}>]>;
export declare const CameraReadings: Schema.Struct<{
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
export declare const MountReadings: Schema.Struct<{
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
export declare const FocuserReadings: Schema.Struct<{
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
export declare const WeatherReadings: Schema.Struct<{
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
export declare const SwitchReadings: Schema.Struct<{
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
export declare const SwitchChannel: Schema.Struct<{
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
}>;
declare const identity: {
    id: Schema.brand<Schema.String, "DeviceId">;
    name: Schema.String;
    bindingId: Schema.brand<Schema.String, "BindingId">;
    failureDomain: Schema.brand<Schema.String, "FailureDomain">;
    availability: Schema.Union<readonly [Schema.Struct<{
        readonly ready: Schema.Literal<true>;
    }>, Schema.Struct<{
        readonly ready: Schema.Literal<false>;
        readonly reason: Schema.Literals<readonly ["commands-disabled", "blocked", "unavailable", "starting", "disconnected", "stale", "busy", "refreshing"]>;
        readonly message: Schema.String;
    }>]>;
    quarantine: Schema.Union<readonly [Schema.Struct<{
        readonly held: Schema.Literal<false>;
    }>, Schema.Struct<{
        readonly held: Schema.Literal<true>;
        readonly reason: Schema.String;
        readonly since: Schema.Number;
    }>]>;
    /** The latest settled operation in the domain that every fresh reading here postdates. */
    afterOperation: Schema.NullOr<Schema.brand<Schema.String, "OperationId">>;
};
export declare const Device: Schema.Union<readonly [Schema.Struct<{
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
    /** The last setpoint the driver acknowledged; INDI never reports the target back. */
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
}>]>;
export type Device = typeof Device.Type;
/** What a device of kind D reports about itself: its wire shape minus what Cria decides around it. */
export type DeviceBody<D extends DeviceKind> = Omit<Extract<Device, {
    readonly kind: D;
}>, keyof typeof identity>;
export type ReadingsOf<D extends DeviceKind> = Extract<Device, {
    readonly kind: D;
}>['readings'];
export {};
//# sourceMappingURL=device.d.ts.map