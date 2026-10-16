/**
 * Reading: INDI properties as Readings, decided once for every capability.
 *
 * - fresh: the driver is answering (liveness), the indiserver connection is up
 *   and the property is not in Alert;
 * - stale: we have a value but one of those is not true;
 * - unavailable: never read, not supported by this device, or gone.
 */
import { Effect } from 'effect'
import type { ConnectionStatus, IndiDevice, Property } from '@cria/indi'
import { Reading } from '@cria/primitives'
import type { Liveness } from './liveness.js'

type ReadingOf<T> = Reading.Reading<T>

/** How long after connecting a missing property means "this device doesn't have it". */
const definitionsSettleMs = 2000

export interface DeviceSnapshot {
  readonly device: string
  readonly property: (name: string) => Property | undefined
  /** The first of `names` the device defines, read through `extract`. */
  readonly reading: <T>(
    names: string | ReadonlyArray<string>,
    extract: (property: Property) => T | undefined,
    options?: ReadingOptions,
  ) => ReadingOf<T>
  readonly connected: ReadingOf<boolean>
  readonly name: ReadingOf<string>
  /** Liveness, connection and CONNECT all good: values may be acted on. */
  readonly live: boolean
}

export interface ReadingOptions {
  /**
   * INDI's Alert is ambiguous. On a telemetry property (a temperature) it
   * usually means the driver failed to read the hardware, so the value is old:
   * stale. On a command property (an exposure, a focuser position, the mount's
   * coordinates) it means the last command failed while the value is still
   * reported: set this to false.
   */
  readonly alertMeansStale?: boolean
}

export function takeSnapshot(
  device: IndiDevice,
  liveness: Liveness,
  connection: Effect.Effect<ConnectionStatus>,
): Effect.Effect<DeviceSnapshot> {
  return Effect.gen(function* () {
    const takenAt = Date.now()
    const properties = new Map((yield* device.properties).map(property => [property.name, property]))
    const state = yield* liveness.state
    const status = yield* connection

    const alive =
      status.kind === 'connected' &&
      state.failing === undefined &&
      state.confirmedAt !== undefined &&
      takenAt - state.confirmedAt <= liveness.freshForMs

    const connectedNow = properties.get('CONNECTION')?.elements.get('CONNECT')
    const isConnected = connectedNow?.kind === 'switch' && connectedNow.on
    const settled =
      isConnected &&
      state.connectedSince !== undefined &&
      takenAt - Math.max(state.connectedSince, state.definedAt ?? 0) > definitionsSettleMs

    const reading = <T>(
      names: string | ReadonlyArray<string>,
      extract: (property: Property) => T | undefined,
      options: ReadingOptions = {},
    ): ReadingOf<T> => {
      const candidates = typeof names === 'string' ? [names] : names
      const property = candidates.map(name => properties.get(name)).find(found => found !== undefined)

      if (!property) {
        if (status.kind !== 'connected') return Reading.unavailable('failed', 'indiserver is not connected')
        if (properties.size === 0) return Reading.unavailable('failed', `${device.name} is not defined by indiserver`)
        if (!isConnected) return Reading.unavailable('failed', `${device.name} is disconnected`)

        return settled ? Reading.unavailable('unsupported') : Reading.unavailable('not-read')
      }

      const value = extract(property)

      if (value === undefined) return Reading.unavailable('unsupported')
      const observedAt = Math.max(state.confirmedAt ?? 0, property.receivedAt)

      if (!alive || (property.state === 'Alert' && options.alertMeansStale !== false)) return Reading.stale(value, observedAt)

      return Reading.fresh(value, observedAt)
    }

    const connected = reading('CONNECTION', property => {
      const element = property.elements.get('CONNECT')

      return element?.kind === 'switch' ? element.on : undefined
    })

    const name: ReadingOf<string> =
      properties.size === 0
        ? Reading.unavailable('failed', `${device.name} is not defined by indiserver`)
        : alive
          ? Reading.fresh(device.name, state.confirmedAt ?? takenAt)
          : Reading.stale(device.name, state.confirmedAt ?? 0)

    return {
      device: device.name,
      property: name => properties.get(name),
      reading,
      connected,
      name,
      live: alive && isConnected,
    }
  })
}

export function numberElement(element: string) {
  return (property: Property | undefined) => {
    const found = property?.elements.get(element)

    return found?.kind === 'number' ? found.value : undefined
  }
}

export function switchElement(element: string) {
  return (property: Property | undefined) => {
    const found = property?.elements.get(element)

    return found?.kind === 'switch' ? found.on : undefined
  }
}

export function textElement(element: string) {
  return (property: Property | undefined) => {
    const found = property?.elements.get(element)

    return found?.kind === 'text' ? found.value : undefined
  }
}

/** The first element of `names` that the property has, as a number. */
export function firstNumberElement(names: ReadonlyArray<string>) {
  return (property: Property) => {
    for (const name of names) {
      const found = property.elements.get(name)

      if (found?.kind === 'number') return found.value
    }

    return undefined
  }
}

export function limitElement(names: ReadonlyArray<string>, which: 'min' | 'max') {
  return (property: Property) => {
    for (const name of names) {
      const found = property.elements.get(name)

      if (found?.kind === 'number') return found[which]
    }

    return undefined
  }
}
