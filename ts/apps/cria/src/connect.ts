import { Clock, Data, Effect, Option } from 'effect'
import type { DeviceSubscription, IndiDevice, IndiError, Property, Values } from '@cria/indi'
import type { ConnectResult } from '@cria/wire'
import type { Config, DeviceConfig } from './config.js'

class Ended extends Data.TaggedError('Ended')<{ readonly outcome: 'failed' | 'uncertain'; readonly message: string }> {}

interface Step {
  readonly property: string
  readonly values: Values
  readonly holds: (property: Property) => boolean
  readonly alreadyHolds?: (property: Property) => boolean
}

const sentPrecision = 1e-6

type Settings = Pick<Config, 'confirmMs' | 'connectTimeoutMs' | 'definitionWaitMs'>

const switchOn = (element: string) => (property: Property) => {
  const found = property.elements.get(element)

  return found?.kind === 'switch' && found.on
}

const textIs = (element: string, wanted: string) => (property: Property) => {
  const found = property.elements.get(element)

  return found?.kind === 'text' && found.value === wanted
}

const numbersAre = (wanted: Readonly<Record<string, number>>) => (property: Property) =>
  Object.entries(wanted).every(([element, value]) => {
    const found = property.elements.get(element)

    return found?.kind === 'number' && Math.abs(found.value - value) <= sentPrecision
  })

const settled = (holds: (property: Property) => boolean) => (property: Property) => property.state !== 'Busy' && holds(property)

function sendEnded(error: IndiError): Ended {
  return new Ended({ outcome: error.reason === 'connection-lost' ? 'uncertain' : 'failed', message: error.message })
}

function answered(device: IndiDevice, subscription: DeviceSubscription, property: string, holds: (property: Property) => boolean): Effect.Effect<void, Ended> {
  return Effect.gen(function* () {
    while (true) {
      const event = yield* subscription.next

      if (event.type === 'property' && event.property.name === property) {
        if (event.property.state === 'Alert')
          return yield* new Ended({ outcome: 'failed', message: `${property} on ${device.name}: ${event.property.message ?? 'the driver reported Alert'}` })
        if (holds(event.property)) return
      }

      if (event.type === 'deleted' && (event.name === undefined || event.name === property))
        return yield* new Ended({ outcome: 'uncertain', message: `${device.name} went away before ${property} showed the value` })

      if (event.type === 'connection' && event.status.kind !== 'connected')
        return yield* new Ended({ outcome: 'uncertain', message: `indiserver connection lost before ${property} on ${device.name} showed the value` })
    }
  })
}

function change(device: IndiDevice, property: string, values: Values, holds: (property: Property) => boolean, withinMs: number): Effect.Effect<void, Ended> {
  return Effect.scoped(
    Effect.gen(function* () {
      const subscription = yield* device.subscribe

      yield* device.send(property, values).pipe(Effect.mapError(sendEnded))

      const shown = yield* Effect.timeoutOption(answered(device, subscription, property, holds), withinMs)

      if (Option.isNone(shown)) return yield* new Ended({ outcome: 'uncertain', message: `${property} on ${device.name} did not show the value within ${withinMs} ms` })
    }),
  )
}

function stepsFor(device: DeviceConfig, now: number): ReadonlyArray<Step> {
  const upload: Step = { property: 'UPLOAD_MODE', values: { UPLOAD_CLIENT: true }, holds: switchOn('UPLOAD_CLIENT'), alreadyHolds: switchOn('UPLOAD_CLIENT') }
  const site = device.site
  const coordinates = site && { LAT: site.latitudeDegrees, LONG: (site.longitudeDegrees + 360) % 360, ELEV: site.elevationMeters }
  const utc = new Date(now).toISOString().slice(0, 19)
  const debug: ReadonlyArray<Step> = [
    { property: 'DEBUG', values: { ENABLE: true }, holds: switchOn('ENABLE'), alreadyHolds: switchOn('ENABLE') },
    { property: 'DEBUG_LEVEL', values: { DBG_DEBUG: true }, holds: switchOn('DBG_DEBUG'), alreadyHolds: switchOn('DBG_DEBUG') },
  ]

  return [
    ...(device.kind === 'camera' ? [upload] : []),
    ...(coordinates ? [{ property: 'GEOGRAPHIC_COORD', values: coordinates, holds: settled(numbersAre(coordinates)) }] : []),
    ...(device.kind === 'mount' ? [{ property: 'TIME_UTC', values: { UTC: utc, OFFSET: '0.00' }, holds: settled(textIs('UTC', utc)) }] : []),
    ...(device.driverDebug === true ? debug : []),
  ]
}

const describeValues = (values: Values) => Object.entries(values).map(([element, value]) => `${element}=${typeof value === 'boolean' ? (value ? 'On' : 'Off') : value}`).join(' ')

function definedWithin(indi: IndiDevice, name: string, withinMs: number): Effect.Effect<Option.Option<Property>> {
  return Effect.scoped(
    Effect.gen(function* () {
      const subscription = yield* indi.subscribe
      const known = yield* indi.property(name)

      if (Option.isSome(known)) return known

      const defined = Effect.gen(function* () {
        while (true) {
          const event = yield* subscription.next

          if (event.type === 'property' && event.origin === 'def' && event.property.name === name) return event.property
        }
      })

      return yield* Effect.timeoutOption(defined, withinMs)
    }),
  )
}

function setUp(indi: IndiDevice, device: DeviceConfig, settings: Settings): Effect.Effect<string, Ended> {
  return Effect.gen(function* () {
    const notes: string[] = []

    for (const step of stepsFor(device, yield* Clock.currentTimeMillis)) {
      const defined = yield* definedWithin(indi, step.property, settings.definitionWaitMs)

      if (Option.isNone(defined)) notes.push(`${step.property} skipped: not defined`)
      else if (step.alreadyHolds?.(defined.value)) notes.push(`${step.property} already set`)
      else {
        yield* change(indi, step.property, step.values, step.holds, settings.confirmMs).pipe(
          Effect.mapError(error => new Ended({ outcome: error.outcome, message: `setup: ${error.message}` })),
        )
        notes.push(`sent ${step.property} ${describeValues(step.values)}`)
      }
    }

    return notes.join('; ')
  })
}

function connection(indi: IndiDevice, device: DeviceConfig, connected: boolean, settings: Settings): Effect.Effect<void, Ended> {
  return Effect.gen(function* () {
    const current = yield* indi.property('CONNECTION')

    if (Option.isNone(current)) return yield* new Ended({ outcome: 'failed', message: `${indi.name} is not defined by indiserver` })

    const port = device.port

    if (connected && port !== undefined) {
      const shown = yield* indi.property('DEVICE_PORT')

      if (Option.isSome(shown) && !textIs('PORT', port)(shown.value)) yield* change(indi, 'DEVICE_PORT', { PORT: port }, textIs('PORT', port), settings.confirmMs)
    }

    if (switchOn('CONNECT')(current.value) === connected && current.value.state !== 'Busy') return

    yield* change(indi, 'CONNECTION', connected ? { CONNECT: true } : { DISCONNECT: true }, settled(property => switchOn('CONNECT')(property) === connected), settings.connectTimeoutMs)
  })
}

export function connectDevice(indi: IndiDevice, device: DeviceConfig, connected: boolean, settings: Settings): Effect.Effect<ConnectResult> {
  return Effect.gen(function* () {
    yield* connection(indi, device, connected, settings)

    return connected ? { outcome: 'confirmed', setup: yield* setUp(indi, device, settings) } satisfies ConnectResult : { outcome: 'confirmed' } satisfies ConnectResult
  }).pipe(Effect.match({ onFailure: ended => ({ outcome: ended.outcome, message: ended.message }) satisfies ConnectResult, onSuccess: result => result }))
}
