import { Effect, Exit, Scope } from 'effect'
import { makeIndiClient, type Property } from '../indi/index.ts'

export type ConnectionState = 'connected' | 'disconnected' | 'changing'

export interface DeviceFacts {
  readonly connection: ConnectionState
  readonly busy: ReadonlyArray<string>
}

export interface IndiSnapshot {
  readonly linked: boolean
  readonly devices: ReadonlyMap<string, DeviceFacts>
}

export interface IndiView {
  readonly view: () => Promise<IndiSnapshot>
  readonly close: () => Promise<void>
}

export function indiFacts(properties: ReadonlyArray<Pick<Property, 'name' | 'state' | 'elements'>>): DeviceFacts | undefined {
  if (properties.length === 0) return undefined

  const connection = properties.find(property => property.name === 'CONNECTION')
  const connect = connection?.elements.get('CONNECT')
  const state: ConnectionState = connection?.state === 'Busy' ? 'changing' : connect?.kind === 'switch' && connect.on ? 'connected' : 'disconnected'

  return { connection: state, busy: properties.filter(property => property.state === 'Busy').map(property => property.name) }
}

export async function openIndiView(options: { readonly host: string; readonly port: number; readonly devices: ReadonlyArray<string> }): Promise<IndiView> {
  const scope = Effect.runSync(Scope.make())
  const client = await Effect.runPromise(Scope.provide(makeIndiClient({ host: options.host, port: options.port, warn: () => {} }), scope))

  return {
    view: async () => {
      const status = await Effect.runPromise(client.status)
      const facts = new Map<string, DeviceFacts>()

      for (const name of options.devices) {
        const found = indiFacts(await Effect.runPromise(client.device(name).properties))

        if (found) facts.set(name, found)
      }

      return { linked: status.kind === 'connected', devices: facts }
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
