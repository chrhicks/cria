/** View: the 15 operation kinds as one table. */
import { Schema } from 'effect';
import { type DeviceKind } from './device.js';
export declare const captureFrameTypes: readonly ['light', 'flat', 'dark', 'bias'];
export type CaptureFrameType = (typeof captureFrameTypes)[number];
/** What `light` means for each frame type: true when the shutter is open. */
export declare const shutterOpen: {
    readonly light: true;
    readonly flat: true;
    readonly dark: false;
    readonly bias: false;
};
interface Row {
    readonly device: DeviceKind | 'any';
    readonly halt: boolean;
    readonly parameters: Schema.Top;
}
type Table<T extends Record<string, Row>> = {
    readonly [K in keyof T & string]: T[K] & {
        readonly schema: Schema.Struct<{
            readonly kind: Schema.Literal<K>;
            readonly parameters: T[K]['parameters'];
        }>;
    };
};
export declare const commands: Table<{
    readonly capture: {
        readonly device: "camera";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly exposureSeconds: Schema.Number;
            readonly light: Schema.Boolean;
            readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
            readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
        }>;
    };
    readonly 'camera-configure': {
        readonly device: "camera";
        readonly halt: false;
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
    };
    readonly cooling: {
        readonly device: "camera";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
            readonly setpointC: Schema.optionalKey<Schema.Number>;
        }>;
    };
    readonly 'focuser-move': {
        readonly device: "focuser";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly position: Schema.Number;
            readonly minPosition: Schema.Number;
            readonly maxPosition: Schema.Number;
        }>;
    };
    readonly 'focuser-halt': {
        readonly device: "focuser";
        readonly halt: true;
        readonly parameters: Schema.Struct<{}>;
    };
    readonly 'mount-slew': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly rightAscensionDegrees: Schema.Number;
            readonly declinationDegrees: Schema.Number;
            readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
        }>;
    };
    readonly 'mount-tracking': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly tracking: Schema.Boolean;
        }>;
    };
    readonly 'mount-axis': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly rateDegreesPerSecond: Schema.Number;
            readonly durationSeconds: Schema.Number;
        }>;
    };
    readonly 'mount-rotate': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly rateDegreesPerSecond: Schema.Number;
            readonly distanceDegrees: Schema.Number;
        }>;
    };
    readonly 'mount-home': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{}>;
    };
    readonly 'mount-stop': {
        readonly device: "mount";
        readonly halt: true;
        readonly parameters: Schema.Struct<{}>;
    };
    readonly 'mount-park': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{}>;
    };
    readonly 'mount-unpark': {
        readonly device: "mount";
        readonly halt: false;
        readonly parameters: Schema.Struct<{}>;
    };
    readonly 'switch-set': {
        readonly device: "switch";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly channelId: Schema.Number;
            readonly value: Schema.Number;
        }>;
    };
    readonly 'device-connect': {
        readonly device: "any";
        readonly halt: false;
        readonly parameters: Schema.Struct<{
            readonly connected: Schema.Boolean;
        }>;
    };
}>;
type Commands = typeof commands;
export declare const CommandSchema: Schema.Union<(Schema.Struct<{
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
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"capture">;
    readonly parameters: Schema.Struct<{
        readonly exposureSeconds: Schema.Number;
        readonly light: Schema.Boolean;
        readonly frameType: Schema.optionalKey<Schema.Literals<readonly ["light", "flat", "dark", "bias"]>>;
        readonly monochromeOnly: Schema.optionalKey<Schema.Boolean>;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"cooling">;
    readonly parameters: Schema.Struct<{
        readonly coolerOn: Schema.optionalKey<Schema.Boolean>;
        readonly setpointC: Schema.optionalKey<Schema.Number>;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"device-connect">;
    readonly parameters: Schema.Struct<{
        readonly connected: Schema.Boolean;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"focuser-halt">;
    readonly parameters: Schema.Struct<{}>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"focuser-move">;
    readonly parameters: Schema.Struct<{
        readonly position: Schema.Number;
        readonly minPosition: Schema.Number;
        readonly maxPosition: Schema.Number;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-axis">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Number;
        readonly durationSeconds: Schema.Number;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-home">;
    readonly parameters: Schema.Struct<{}>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-park">;
    readonly parameters: Schema.Struct<{}>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-rotate">;
    readonly parameters: Schema.Struct<{
        readonly rateDegreesPerSecond: Schema.Number;
        readonly distanceDegrees: Schema.Number;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-slew">;
    readonly parameters: Schema.Struct<{
        readonly rightAscensionDegrees: Schema.Number;
        readonly declinationDegrees: Schema.Number;
        readonly coordinateSystem: Schema.Literals<readonly ["topocentric", "j2000"]>;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-stop">;
    readonly parameters: Schema.Struct<{}>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-tracking">;
    readonly parameters: Schema.Struct<{
        readonly tracking: Schema.Boolean;
    }>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-unpark">;
    readonly parameters: Schema.Struct<{}>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"switch-set">;
    readonly parameters: Schema.Struct<{
        readonly channelId: Schema.Number;
        readonly value: Schema.Number;
    }>;
}>)[]>;
export declare const HaltCommandSchema: Schema.Union<(Schema.Struct<{
    readonly kind: Schema.Literal<"focuser-halt">;
    readonly parameters: Schema.Struct<{}>;
}> | Schema.Struct<{
    readonly kind: Schema.Literal<"mount-stop">;
    readonly parameters: Schema.Struct<{}>;
}>)[]>;
export type Command = typeof CommandSchema.Type;
export type HaltCommand = typeof HaltCommandSchema.Type;
export type CommandKind = keyof Commands;
export type HaltKind = HaltCommand['kind'];
export type ParamsOf<K extends CommandKind> = Commands[K]['parameters']['Type'];
export type DeviceFor<K extends CommandKind> = Commands[K]['device'];
export declare const isHalt: <C extends {
    readonly kind: CommandKind;
}>(command: C) => command is Extract<C, {
    readonly kind: HaltKind;
}>;
export {};
//# sourceMappingURL=command.d.ts.map