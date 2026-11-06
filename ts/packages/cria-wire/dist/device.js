/**
 * View: a device, one shape per kind so every reading has a typed value.
 * Values are named (`'east'`, `'sidereal'`), not ASCOM integers.
 */
import { Schema } from 'effect';
import { BindingId, DeviceId, FailureDomain, OperationId } from './ids.js';
import { Reading, Timestamp } from './values.js';
export const deviceKinds = ['camera', 'mount', 'focuser', 'weather', 'switch'];
export const coordinateFrames = ['topocentric', 'j2000'];
export const availabilityReasons = [
    'commands-disabled',
    'blocked',
    'unavailable',
    'starting',
    'disconnected',
    'stale',
    'busy',
    'refreshing',
];
export const Availability = Schema.Union([
    Schema.Struct({ ready: Schema.Literal(true) }),
    Schema.Struct({ ready: Schema.Literal(false), reason: Schema.Literals(availabilityReasons), message: Schema.String }),
]);
export const Quarantine = Schema.Union([
    Schema.Struct({ held: Schema.Literal(false) }),
    Schema.Struct({ held: Schema.Literal(true), reason: Schema.String, since: Timestamp }),
]);
const number = Reading(Schema.Number);
const boolean = Reading(Schema.Boolean);
const common = {
    connected: boolean,
    name: Reading(Schema.String),
};
export const CameraReadings = Schema.Struct({
    ...common,
    activity: Reading(Schema.Literals(['idle', 'exposing'])),
    temperatureC: number,
    setpointC: number,
    coolerOn: boolean,
    coolerPowerPercent: number,
    sensorWidthPixels: number,
    sensorHeightPixels: number,
    pixelWidthMicrons: number,
    pixelHeightMicrons: number,
    binX: number,
    binY: number,
    width: number,
    height: number,
    startX: number,
    startY: number,
    maxBinX: number,
    maxBinY: number,
    bayerPattern: Reading(Schema.Literals(['mono', 'rggb', 'grbg', 'gbrg', 'bggr'])),
    canAbortExposure: boolean,
    canSetTemperature: boolean,
    canGetCoolerPower: boolean,
    exposureMinimum: number,
    exposureMaximum: number,
    gain: number,
    gainMinimum: number,
    gainMaximum: number,
    offset: number,
    offsetMinimum: number,
    offsetMaximum: number,
});
export const MountReadings = Schema.Struct({
    ...common,
    rightAscensionHours: number,
    declinationDegrees: number,
    siderealTimeHours: number,
    slewing: boolean,
    tracking: boolean,
    parked: boolean,
    trackingRate: Reading(Schema.Literals(['sidereal', 'lunar', 'solar'])),
    rightAscensionRateSecondsPerSiderealSecond: number,
    declinationRateArcsecondsPerSecond: number,
    pierSide: Reading(Schema.Literals(['east', 'west', 'unknown'])),
    coordinateSystem: Reading(Schema.Literals(coordinateFrames)),
    latitudeDegrees: number,
    longitudeDegrees: number,
    elevationMeters: number,
    canSlew: boolean,
    canSetTracking: boolean,
    canFindHome: boolean,
    canPark: boolean,
    canUnpark: boolean,
    canMovePrimaryAxis: boolean,
    primaryAxisRates: Reading(Schema.Array(Schema.Struct({ name: Schema.String, degreesPerSecond: Schema.Number }))),
});
export const FocuserReadings = Schema.Struct({
    ...common,
    position: number,
    moving: boolean,
    temperatureC: number,
    absolute: boolean,
    minStep: number,
    maxStep: number,
});
export const WeatherReadings = Schema.Struct({
    ...common,
    temperatureC: number,
    humidityPercent: number,
    dewPointC: number,
    pressureHpa: number,
    skyTemperatureC: number,
    cloudCoverPercent: number,
    rainRateMmPerHour: number,
    windSpeedMps: number,
    windGustMps: number,
});
export const SwitchReadings = Schema.Struct({ ...common, channelCount: number });
export const SwitchChannel = Schema.Struct({
    id: number,
    name: Reading(Schema.String),
    writable: boolean,
    minimum: number,
    maximum: number,
    step: number,
    on: boolean,
    value: number,
});
const identity = {
    id: DeviceId,
    name: Schema.String,
    bindingId: BindingId,
    failureDomain: FailureDomain,
    availability: Availability,
    quarantine: Quarantine,
    /** The latest settled operation in the domain that every fresh reading here postdates. */
    afterOperation: Schema.NullOr(OperationId),
};
export const Device = Schema.Union([
    Schema.Struct({
        ...identity,
        kind: Schema.Literal('camera'),
        readings: CameraReadings,
        /** The last setpoint the driver acknowledged; INDI never reports the target back. */
        lastCommandedSetpointC: Schema.NullOr(Schema.Struct({ value: Schema.Number, commandedAt: Timestamp })),
    }),
    Schema.Struct({ ...identity, kind: Schema.Literal('mount'), readings: MountReadings }),
    Schema.Struct({ ...identity, kind: Schema.Literal('focuser'), readings: FocuserReadings }),
    Schema.Struct({ ...identity, kind: Schema.Literal('weather'), readings: WeatherReadings }),
    Schema.Struct({ ...identity, kind: Schema.Literal('switch'), readings: SwitchReadings, channels: Schema.Array(SwitchChannel) }),
]);
//# sourceMappingURL=device.js.map