import type { Direction } from '@cria/indi'

const firstTagDevice = /^\s*<[^>]*?\bdevice="([^"]+)"/

export function wireSubject(devices: Readonly<Record<string, string>>, dir: Direction, xml: string) {
  const device = firstTagDevice.exec(xml)?.[1]

  if (device === undefined) return `rig-dev.wire.server.${dir}`

  return `rig-dev.wire.${devices[device] ?? 'other'}.${dir}`
}
