import type { Direction, WireFacts } from '../indi/index.ts'

export function wireDeviceId(devices: Readonly<Record<string, string>>, facts: WireFacts) {
  return facts.indiDevice === undefined ? 'server' : (devices[facts.indiDevice] ?? 'other')
}

export function wireSubject(device: string, dir: Direction) {
  return `rig-dev.wire.${device}.${dir}`
}

export const streamName = 'RIG_DEV'

export const streamSubjects = ['rig-dev.>']
