/** View: the 15 operation kinds as one table. */
import { Schema } from 'effect';
import { coordinateFrames } from './device.js';
const between = (minimum, maximum) => Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum, maximum })));
const integer = (minimum, maximum) => Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum, maximum })));
const nonZero = (minimum, maximum) => between(minimum, maximum).pipe(Schema.check(Schema.makeFilter((value) => value !== 0 || 'must not be zero')));
const atLeastOne = Schema.makeFilter((parameters) => Object.keys(parameters).length > 0 || 'at least one setting is required');
const empty = Schema.Struct({});
function table(rows) {
    // Object.fromEntries forgets the keys; Table<T> restores them.
    return Object.fromEntries(Object.entries(rows).map(([kind, row]) => [kind, { ...row, schema: Schema.Struct({ kind: Schema.Literal(kind), parameters: row.parameters }) }]));
}
export const commands = table({
    capture: {
        device: 'camera',
        halt: false,
        parameters: Schema.Struct({
            exposureSeconds: between(0.000001, 3600),
            light: Schema.Boolean,
            monochromeOnly: Schema.optionalKey(Schema.Boolean),
        }),
    },
    'camera-configure': {
        device: 'camera',
        halt: false,
        parameters: Schema.Struct({
            binX: Schema.optionalKey(integer(1, 1_000_000)),
            binY: Schema.optionalKey(integer(1, 1_000_000)),
            startX: Schema.optionalKey(integer(0, 1_000_000)),
            startY: Schema.optionalKey(integer(0, 1_000_000)),
            width: Schema.optionalKey(integer(1, 1_000_000)),
            height: Schema.optionalKey(integer(1, 1_000_000)),
            gain: Schema.optionalKey(integer(0, 1_000_000)),
            offset: Schema.optionalKey(integer(0, 1_000_000)),
        }).pipe(Schema.check(atLeastOne)),
    },
    cooling: {
        device: 'camera',
        halt: false,
        parameters: Schema.Struct({
            coolerOn: Schema.optionalKey(Schema.Boolean),
            setpointC: Schema.optionalKey(between(-100, 100)),
        }).pipe(Schema.check(atLeastOne)),
    },
    'focuser-move': {
        device: 'focuser',
        halt: false,
        parameters: Schema.Struct({
            position: integer(1, 2_147_483_646),
            minPosition: integer(1, 2_147_483_646),
            maxPosition: integer(1, 2_147_483_646),
        }).pipe(Schema.check(Schema.makeFilter((move) => (move.minPosition <= move.maxPosition && move.position >= move.minPosition && move.position <= move.maxPosition) ||
            'Target is outside the requested focuser travel window'))),
    },
    'focuser-halt': { device: 'focuser', halt: true, parameters: empty },
    'mount-slew': {
        device: 'mount',
        halt: false,
        parameters: Schema.Struct({
            rightAscensionDegrees: between(0, 359.999999999),
            declinationDegrees: between(-90, 90),
            coordinateSystem: Schema.Literals(coordinateFrames),
        }),
    },
    'mount-tracking': { device: 'mount', halt: false, parameters: Schema.Struct({ tracking: Schema.Boolean }) },
    'mount-axis': {
        device: 'mount',
        halt: false,
        parameters: Schema.Struct({ rateDegreesPerSecond: nonZero(-10, 10), durationSeconds: between(0.001, 120) }),
    },
    'mount-rotate': {
        device: 'mount',
        halt: false,
        parameters: Schema.Struct({ rateDegreesPerSecond: nonZero(-10, 10), distanceDegrees: nonZero(-120, 120) }),
    },
    'mount-home': { device: 'mount', halt: false, parameters: empty },
    'mount-stop': { device: 'mount', halt: true, parameters: empty },
    'mount-park': { device: 'mount', halt: false, parameters: empty },
    'mount-unpark': { device: 'mount', halt: false, parameters: empty },
    'switch-set': { device: 'switch', halt: false, parameters: Schema.Struct({ channelId: integer(0, 63), value: between(-1e12, 1e12) }) },
    'device-connect': { device: 'any', halt: false, parameters: Schema.Struct({ connected: Schema.Boolean }) },
});
export const CommandSchema = Schema.Union(Object.values(commands).map(entry => entry.schema));
export const HaltCommandSchema = Schema.Union(Object.values(commands)
    .filter((entry) => entry.halt)
    .map(entry => entry.schema));
export const isHalt = (command) => commands[command.kind].halt;
//# sourceMappingURL=command.js.map