/**
 * Capability: weather. Readings only, from INDI's standard weather interface
 * (the Pegasus PPB Micro and the weather simulator both use WEATHER_PARAMETERS).
 */
import { Effect } from 'effect'
import type { CapabilityContext } from './context.js'
import { numberElement, type DeviceSnapshot } from './fields.js'
import type { DeviceBody, ReadingsOf } from '@cria/wire'

export interface Weather {
  readonly observe: Effect.Effect<DeviceBody<'weather'>>
}

function readings(snapshot: DeviceSnapshot): ReadingsOf<'weather'> {
  const parameter = (element: string) => snapshot.reading('WEATHER_PARAMETERS', numberElement(element))

  return {
    connected: snapshot.connected,
    name: snapshot.name,
    temperatureC: parameter('WEATHER_TEMPERATURE'),
    humidityPercent: parameter('WEATHER_HUMIDITY'),
    dewPointC: parameter('WEATHER_DEWPOINT'),
  }
}

export function makeWeather(context: CapabilityContext): Weather {
  return { observe: Effect.map(context.snapshot, snapshot => ({ kind: 'weather', readings: readings(snapshot) })) }
}
