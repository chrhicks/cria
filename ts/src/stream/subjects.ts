import type { Direction } from '../indi/index.ts'

const firstTagDevice = /^\s*<[^>]*?\bdevice="([^"]+)"/

function wireDevice(devices: Readonly<Record<string, string>>, xml: string) {
  const device = firstTagDevice.exec(xml)?.[1]

  return device === undefined ? 'server' : (devices[device] ?? 'other')
}

export function wireSubject(devices: Readonly<Record<string, string>>, dir: Direction, xml: string) {
  return `rig-dev.wire.${wireDevice(devices, xml)}.${dir}`
}

export const refreshSubject = 'rig-dev.refresh'
