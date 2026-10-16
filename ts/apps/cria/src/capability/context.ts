/**
 * What every capability is built from: one INDI device, a way to take a
 * snapshot of its Readings, and the command deadlines.
 */
import { Effect } from 'effect'
import type { IndiDevice } from '@cria/indi'
import { Failed, Reading } from '@cria/primitives'
import type { DeviceSnapshot } from './fields.js'

export interface CapabilityContext {
  readonly device: IndiDevice
  readonly snapshot: Effect.Effect<DeviceSnapshot>
  readonly timing: {
    readonly acknowledgeMs: number
    readonly operationTimeoutMs: number
    readonly readoutAllowanceMs: number
  }
}

/**
 * The fresh snapshot a command may act on. A command never acts on stale or
 * missing facts: it fails before sending anything.
 */
export function liveSnapshot(context: CapabilityContext): Effect.Effect<DeviceSnapshot, Failed> {
  return Effect.gen(function* () {
    const snapshot = yield* context.snapshot

    if (snapshot.connected.status === 'fresh' && !snapshot.connected.value)
      return yield* new Failed({ reason: 'disconnected', message: `${snapshot.device} is disconnected` })
    if (!snapshot.live)
      return yield* new Failed({ reason: 'unavailable', message: `${snapshot.device} readings are not current` })

    return snapshot
  })
}

export const required = Reading.required

export function invalid(message: string) {
  return new Failed({ reason: 'invalid', message })
}
