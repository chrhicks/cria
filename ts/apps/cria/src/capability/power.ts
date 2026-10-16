/**
 * Capability: power (a switch device). Configured channels, each one INDI
 * element: an on/off switch (the PPB Micro's 12 V master) or a number (a dew
 * heater's duty cycle). Setting one is `switchConfirmed` or `numbersApplied`.
 *
 * Cria does not judge what a channel feeds. Turning the 12 V master off drops
 * the mount, the main camera and everything on its USB hub; that decision is
 * Chris's, made in Vela.
 */
import { Effect } from 'effect'
import type { ElementDefinition } from '@cria/indi'
import { Failed, Reading, type Uncertain } from '@cria/primitives'
import { numbersApplied, switchConfirmed } from './commands.js'
import { invalid, liveSnapshot, required, type CapabilityContext } from './context.js'
import { numberElement, type DeviceSnapshot } from './fields.js'
import type { DeviceBody } from '@cria/wire'

type R<T> = Reading.Reading<T>

export interface ChannelConfig {
  readonly name: string
  readonly property: string
  readonly element: string
  readonly automaticWhileOn?: string
}

export interface Power {
  readonly observe: Effect.Effect<DeviceBody<'switch'>>
  readonly set: (channelId: number, value: number) => Effect.Effect<{ value: number }, Failed | Uncertain>
}

function channelReadings(snapshot: DeviceSnapshot, channel: ChannelConfig, id: number): DeviceBody<'switch'>['channels'][number] {
  const element = <T>(extract: (found: ElementDefinition) => T | undefined): R<T> =>
    snapshot.reading(channel.property, property => {
      const found = property.elements.get(channel.element)

      return found ? extract(found) : undefined
    })

  return {
    id: Reading.map(snapshot.reading(channel.property, () => true), () => id),
    name: Reading.map(snapshot.reading(channel.property, () => true), () => channel.name),
    writable: snapshot.reading(channel.property, property => property.perm !== 'ro'),
    minimum: element(found => (found.kind === 'number' ? found.min : found.kind === 'switch' ? 0 : undefined)),
    maximum: element(found => (found.kind === 'number' ? found.max : found.kind === 'switch' ? 1 : undefined)),
    step: element(found => (found.kind === 'number' ? found.step : found.kind === 'switch' ? 1 : undefined)),
    on: element(found => (found.kind === 'switch' ? found.on : found.kind === 'number' ? found.value > 0 : undefined)),
    value: element(found => (found.kind === 'number' ? found.value : found.kind === 'switch' ? (found.on ? 1 : 0) : undefined)),
  }
}

export function makePower(context: CapabilityContext, channels: ReadonlyArray<ChannelConfig>): Power {
  const { device, timing } = context

  const observe = (snapshot: DeviceSnapshot): DeviceBody<'switch'> => ({
    kind: 'switch',
    readings: {
      connected: snapshot.connected,
      name: snapshot.name,
      channelCount: Reading.map(snapshot.connected, () => channels.length),
    },
    channels: channels.map((channel, id) => channelReadings(snapshot, channel, id)),
  })

  const set = (channelId: number, value: number) =>
    Effect.gen(function* () {
      const channel = channels[channelId]

      if (!channel) return yield* invalid(`No switch channel ${channelId}`)
      const snapshot = yield* liveSnapshot(context)
      const observed = channelReadings(snapshot, channel, channelId)

      if (!(yield* required(observed.writable, `${channel.name} control`)))
        return yield* new Failed({ reason: 'unsupported', message: `${channel.name} is read-only` })

      const automatic = channels.map((candidate, id) => ({ candidate, id })).find(({ candidate }) => candidate.name === channel.automaticWhileOn)

      // The driver accepts a manual value and then overrides it (auto dew sets the duty back within seconds).
      if (automatic && (yield* required(channelReadings(snapshot, automatic.candidate, automatic.id).on, automatic.candidate.name)))
        return yield* invalid(
          `${channel.name} is set automatically while ${automatic.candidate.name} is on; switch ${automatic.candidate.name} (channel ${automatic.id}) off first`,
        )

      const low = yield* required(observed.minimum, `${channel.name} range`)
      const high = yield* required(observed.maximum, `${channel.name} range`)
      const step = yield* required(observed.step, `${channel.name} step`)
      const offGrid = step > 0 && Math.abs((value - low) / step - Math.round((value - low) / step)) > 1e-6

      if (value < low || value > high || offGrid) return yield* invalid(`${channel.name} accepts ${low}-${high} in steps of ${step}`)

      const kind = snapshot.property(channel.property)?.elements.get(channel.element)?.kind

      if (kind === 'switch') {
        const on = value === 1

        yield* switchConfirmed(
          device,
          channel.property,
          { [channel.element]: on },
          property => {
            const found = property.elements.get(channel.element)

            return found?.kind === 'switch' && found.on === on
          },
          timing,
        )

        return { value }
      }

      // A driver can hold a value at a finer resolution than its step (the PPBA holds 10 % as 9.8039 %).
      const applied = yield* numbersApplied(device, channel.property, { [channel.element]: value }, timing, { [channel.element]: step / 2 })

      return { value: numberElement(channel.element)(applied) ?? value }
    })

  return {
    observe: Effect.map(context.snapshot, observe),
    set,
  }
}
