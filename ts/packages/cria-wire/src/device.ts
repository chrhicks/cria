export const deviceKinds = ['camera', 'mount', 'focuser', 'box'] as const

export type DeviceKind = (typeof deviceKinds)[number]
