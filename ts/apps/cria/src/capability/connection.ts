/**
 * Capability: connection. Connect or disconnect one INDI device with
 * `switchConfirmed`, and the start-up preparation a serial device needs
 * (its port) before connecting.
 */
import { Effect } from 'effect'
import { Failed, type Uncertain } from '@cria/primitives'
import { confirmProperty, sendOnce, switchConfirmed } from './commands.js'
import type { CapabilityContext } from './context.js'
import { switchElement, textElement } from './fields.js'
import type { DeviceSetup } from './setup.js'

export interface Connection {
  /** `setup` summarises what setup wrote, for a device kind that has setup steps. */
  readonly connect: (connected: boolean) => Effect.Effect<{ connected: boolean; setup: string | undefined }, Failed | Uncertain>
}

/** Properties that are Busy while a device is moving or exposing. */
const activity = [
  'CCD_EXPOSURE',
  'EQUATORIAL_EOD_COORD',
  'EQUATORIAL_COORD',
  'TELESCOPE_PARK',
  'TELESCOPE_HOME',
  'TELESCOPE_MOTION_WE',
  'TELESCOPE_MOTION_NS',
  'ABS_FOCUS_POSITION',
]

/** `port`: the serial port a connect sets first if the driver has another one (DEVICE_PORT). */
export function makeConnection(context: CapabilityContext, connectTimeoutMs: number, setup: DeviceSetup, port?: string): Connection {
  const { device, timing } = context

  const connect = (connected: boolean) =>
    Effect.gen(function* () {
      yield* change(connected)

      return { connected, setup: connected ? yield* setup.run : undefined }
    })

  const change = (connected: boolean) =>
    Effect.gen(function* () {
      const snapshot = yield* context.snapshot

      if (!snapshot.property('CONNECTION'))
        return yield* new Failed({ reason: 'unavailable', message: `${device.name} is not defined by indiserver` })

      if (snapshot.connected.status === 'fresh' && snapshot.connected.value === connected) return

      if (connected && port !== undefined && textElement('PORT')(snapshot.property('DEVICE_PORT')) !== port) {
        yield* sendOnce(device, 'DEVICE_PORT', { PORT: port }, timing)
        yield* confirmProperty(device, 'DEVICE_PORT', property => textElement('PORT')(property) === port, 10_000)
      }

      // Idleness has to be a current fact before disconnecting, not a stale one.
      if (!connected && !snapshot.live)
        return yield* new Failed({ reason: 'unavailable', message: `${device.name} readings are not current; cannot tell it is idle` })

      if (!connected && activity.some(name => snapshot.property(name)?.state === 'Busy'))
        return yield* new Failed({ reason: 'busy', message: 'Disconnecting needs idle equipment' })

      yield* switchConfirmed(
        device,
        'CONNECTION',
        connected ? { CONNECT: true } : { DISCONNECT: true },
        property => property.state !== 'Busy' && switchElement('CONNECT')(property) === connected,
        // A cold USB or serial device can take far longer to connect than to answer.
        { ...timing, acknowledgeMs: Math.max(timing.acknowledgeMs, connectTimeoutMs), confirmMs: connectTimeoutMs },
      )
    })

  return { connect }
}
