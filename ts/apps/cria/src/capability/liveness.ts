/**
 * Reading via retryReads: is this device's driver alive and answering?
 *
 * INDI drivers push changes and stay quiet about unchanged values, so a quiet
 * property can't be called fresh on its own. Every `every` ms Cria asks the
 * driver to define CONNECTION again; a timely answer confirms every value the
 * driver holds for the device at that moment. A late or missing answer makes
 * them stale.
 */
import { Effect, Ref, Scope, Stream } from 'effect'
import type { IndiDevice } from '@cria/indi'
import { retryReads } from '@cria/primitives'
import { switchElement } from './fields.js'

export interface LivenessState {
  /** When the last successful liveness read was sent: the conservative "observed at". */
  readonly confirmedAt?: number
  /** Set while the latest liveness read failed. */
  readonly failing?: string
  /** CONNECT has been On since this time. */
  readonly connectedSince?: number
  /** Last time the driver defined a property (other than the liveness read itself). */
  readonly definedAt?: number
}

export interface Liveness {
  readonly state: Effect.Effect<LivenessState>
  /** A confirmation older than this no longer makes a value fresh. */
  readonly freshForMs: number
}

const livenessProperty = 'CONNECTION'

export function makeLiveness(device: IndiDevice, everyMs: number): Effect.Effect<Liveness, never, Scope.Scope> {
  return Effect.gen(function* () {
    const state = yield* Ref.make<LivenessState>({})

    yield* Effect.forkScoped(
      retryReads({
        read: device.read(livenessProperty),
        every: everyMs,
        timeout: Math.max(1000, everyMs),
        report: result =>
          Ref.update(state, current => {
            if (result.kind === 'read') {
              const { failing: _cleared, ...rest } = current

              return { ...rest, confirmedAt: result.startedAt }
            }

            const reason = result.error === 'timeout' ? 'driver did not answer' : result.error.message

            return { ...current, failing: reason }
          }),
      }),
    )

    yield* Effect.forkScoped(
      Stream.runForEach(device.events, event =>
        Ref.update(state, current => {
          if (event.type === 'property' && event.property.name === livenessProperty) {
            const on = switchElement('CONNECT')(event.property) === true

            if (!on) {
              const { connectedSince: _off, ...rest } = current

              return rest
            }

            return current.connectedSince === undefined ? { ...current, connectedSince: Date.now() } : current
          }

          if (event.type === 'property' && event.origin === 'def') return { ...current, definedAt: Date.now() }

          if (event.type === 'deleted' && event.name === undefined) {
            const { connectedSince: _gone, ...rest } = current

            return { ...rest, failing: 'driver removed the device' }
          }

          if (event.type === 'connection' && event.status.kind !== 'connected')
            return { ...current, failing: 'indiserver connection lost' }

          return current
        }),
      ),
    )

    return { state: Ref.get(state), freshForMs: 3 * everyMs }
  })
}
