import { connectIndi, type Property, type PropertyState, type TrafficTap, type Values } from '../indi/index.ts'
import type { WantedValue } from './config.ts'

type ConnectionState = 'connected' | 'disconnected' | 'changing'

export interface PropertyFacts {
  readonly state: PropertyState
  readonly values: Readonly<Record<string, WantedValue>>
}

interface ErrorRun {
  readonly since: number
  readonly last: number
}

export interface DeviceFacts {
  readonly connection: ConnectionState
  readonly busy: ReadonlyArray<string>
  readonly properties: ReadonlyMap<string, PropertyFacts>
  readonly errorRun?: ErrorRun
}

export interface IndiSnapshot {
  readonly devices: ReadonlyMap<string, DeviceFacts>
}

export interface IndiLink {
  readonly closed: Promise<string>
  readonly view: () => IndiSnapshot
  readonly write: (device: string, property: string, values: Values) => Promise<void>
  readonly close: () => void
}

const driverErrorPrefix = '[ERROR]'

function valuesOf(property: Pick<Property, 'elements'>): Record<string, WantedValue> {
  const values: Record<string, WantedValue> = {}

  for (const [name, element] of property.elements) {
    if (element.kind === 'number' || element.kind === 'text') values[name] = element.value
    else if (element.kind === 'switch') values[name] = element.on
  }

  return values
}

export function indiFacts(properties: ReadonlyArray<Pick<Property, 'name' | 'state' | 'elements'>>, errorRun?: ErrorRun): DeviceFacts | undefined {
  if (properties.length === 0) return undefined

  const connection = properties.find(property => property.name === 'CONNECTION')
  const connect = connection?.elements.get('CONNECT')
  const state: ConnectionState = connection?.state === 'Busy' ? 'changing' : connect?.kind === 'switch' && connect.on ? 'connected' : 'disconnected'

  return {
    connection: state,
    busy: properties.filter(property => property.state === 'Busy').map(property => property.name),
    properties: new Map(properties.map(property => [property.name, { state: property.state, values: valuesOf(property) }])),
    ...(errorRun ? { errorRun } : {}),
  }
}

export async function openIndiLink(options: {
  readonly host: string
  readonly port: number
  readonly devices: ReadonlyArray<string>
  readonly errorGapMs: number
  readonly now: () => number
  readonly warn: (line: string) => void
  readonly tap?: TrafficTap
}): Promise<IndiLink> {
  const errorRuns = new Map<string, ErrorRun>()

  const client = await connectIndi({
    host: options.host,
    port: options.port,
    warn: options.warn,
    ...(options.tap ? { tap: options.tap } : {}),
    onMessage: (device, text) => {
      if (device === undefined || !options.devices.includes(device) || !text.startsWith(driverErrorPrefix)) return

      const at = options.now()
      const run = errorRuns.get(device)

      errorRuns.set(device, run && at - run.last <= options.errorGapMs ? { since: run.since, last: at } : { since: at, last: at })
    },
  })

  return {
    closed: client.closed,
    view: () => {
      const devices = new Map<string, DeviceFacts>()

      for (const name of options.devices) {
        const found = indiFacts(client.properties(name), errorRuns.get(name))

        if (found) devices.set(name, found)
      }

      return { devices }
    },
    write: client.send,
    close: client.close,
  }
}
