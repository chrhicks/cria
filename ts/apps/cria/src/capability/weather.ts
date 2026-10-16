/**
 * Capability: weather. Readings only, from INDI's standard weather interface
 * (the Pegasus PPB Micro and the weather simulator both use WEATHER_PARAMETERS).
 */
import { Effect } from 'effect'
import type { Property } from '@cria/indi'
import type { CapabilityContext } from './context.js'
import { numberElement, type DeviceSnapshot } from './fields.js'
import type { DeviceBody, ReadingsOf } from '@cria/wire'

export interface Weather {
  readonly observe: Effect.Effect<DeviceBody<'weather'>>
}

const kilometresPerHour = (property: Property, element: string) => {
  const value = numberElement(element)(property)

  return value === undefined ? undefined : value / 3.6
}

function readings(snapshot: DeviceSnapshot): ReadingsOf<'weather'> {
  const parameter = (element: string) => snapshot.reading('WEATHER_PARAMETERS', numberElement(element))

  return {
    connected: snapshot.connected,
    name: snapshot.name,
    temperatureC: parameter('WEATHER_TEMPERATURE'),
    humidityPercent: parameter('WEATHER_HUMIDITY'),
    dewPointC: parameter('WEATHER_DEWPOINT'),
    pressureHpa: parameter('WEATHER_BAROMETER'),
    skyTemperatureC: parameter('WEATHER_SKY_TEMPERATURE'),
    cloudCoverPercent: parameter('WEATHER_CLOUD_COVER'),
    rainRateMmPerHour: parameter('WEATHER_RAIN_HOUR'),
    windSpeedMps: snapshot.reading('WEATHER_PARAMETERS', property => kilometresPerHour(property, 'WEATHER_WIND_SPEED')),
    windGustMps: snapshot.reading('WEATHER_PARAMETERS', property => kilometresPerHour(property, 'WEATHER_WIND_GUST')),
  }
}

export function makeWeather(context: CapabilityContext): Weather {
  return { observe: Effect.map(context.snapshot, snapshot => ({ kind: 'weather', readings: readings(snapshot) })) }
}
