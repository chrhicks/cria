import { Effect, Exit, Scope, Stream } from 'effect'
import { makeIndiClient, type Property, type PropertyState, type Values } from '../indi/index.ts'
import type { WantedValue } from './config.ts'

export type ConnectionState = 'connected' | 'disconnected' | 'changing'

export interface PropertyFacts {
  readonly state: PropertyState
  readonly values: Readonly<Record<string, WantedValue>>
}

export interface ErrorRun {
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
  readonly linked: boolean
  readonly devices: ReadonlyMap<string, DeviceFacts>
}

export interface IndiLink {
  readonly view: () => Promise<IndiSnapshot>
  readonly write: (device: string, property: string, values: Values) => Promise<void>
  readonly close: () => Promise<void>
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
}): Promise<IndiLink> {
  const scope = Effect.runSync(Scope.make())
  const client = await Effect.runPromise(Scope.provide(makeIndiClient({ host: options.host, port: options.port, warn: () => {} }), scope))
  const errorRuns = new Map<string, ErrorRun>()

  for (const name of options.devices) {
    const listen = Stream.runForEach(client.device(name).events, event =>
      Effect.sync(() => {
        if (event.type !== 'message' || event.device !== name || !event.text.startsWith(driverErrorPrefix)) return

        const at = options.now()
        const run = errorRuns.get(name)

        errorRuns.set(name, run && at - run.last <= options.errorGapMs ? { since: run.since, last: at } : { since: at, last: at })
      }),
    )

    await Effect.runPromise(Scope.provide(Effect.forkScoped(listen), scope))
  }

  return {
    view: async () => {
      const status = await Effect.runPromise(client.status)
      const facts = new Map<string, DeviceFacts>()

      for (const name of options.devices) {
        const found = indiFacts(await Effect.runPromise(client.device(name).properties), errorRuns.get(name))

        if (found) facts.set(name, found)
      }

      return { linked: status.kind === 'connected', devices: facts }
    },
    write: (device, property, values) => Effect.runPromise(client.device(device).send(property, values)),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
