import { Effect, Option, Ref, Scope } from 'effect'
import type { IndiDevice, Property } from '@cria/indi'
import { switchElement } from './fields.js'

export interface DefinitionState {
  readonly connectedSince?: number
  readonly definedAt?: number
  readonly removed?: boolean
}

export type Definitions = Effect.Effect<DefinitionState>

export function trackDefinitions(device: IndiDevice): Effect.Effect<Definitions, never, Scope.Scope> {
  return Effect.gen(function* () {
    const state = yield* Ref.make<DefinitionState>({})
    const subscription = yield* device.subscribe
    const connection = Option.getOrUndefined(yield* device.property('CONNECTION'))

    if (connection) yield* Ref.update(state, current => noteDefinition(noteConnection(current, connection), connection))

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(subscription.next, event =>
          Ref.update(state, current => {
            if (event.type === 'property' && event.property.name === 'CONNECTION') return noteConnection(current, event.property)
            if (event.type === 'property' && event.origin === 'def') return noteDefinition(current, event.property)

            if (event.type === 'deleted' && event.name === undefined) {
              const { connectedSince: _gone, ...rest } = current

              return { ...rest, removed: true }
            }

            return current
          }),
        ),
      ),
    )

    return Ref.get(state)
  })
}

function noteConnection(current: DefinitionState, property: Property): DefinitionState {
  const { removed: _back, connectedSince, ...rest } = current

  if (switchElement('CONNECT')(property) !== true) return rest

  return { ...rest, connectedSince: connectedSince ?? property.receivedAt }
}

function noteDefinition(current: DefinitionState, property: Property): DefinitionState {
  const { removed: _back, ...rest } = current

  return { ...rest, definedAt: property.receivedAt }
}
