/**
 * View: the device kinds a command targets, and the coordinate frames a slew
 * names.
 */
export const deviceKinds = ['camera', 'mount', 'focuser', 'box'] as const

export type DeviceKind = (typeof deviceKinds)[number]

export const coordinateFrames = ['topocentric', 'j2000'] as const
