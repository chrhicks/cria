/**
 * View: Readings and the ledger's facts projected into protocol 5
 * (docs/ts/SPEC.md, "The wire"). Every value here is typed by @cria/wire, so
 * the compiler checks the projection against the contract Vela imports.
 * Readings pass through as the capabilities produce them; what this module
 * decides is availability and afterOperation.
 */
import { Effect } from 'effect'
import type { Device, State } from '@cria/wire'
import { protocolVersion } from '@cria/wire'
import type { Reading } from '@cria/primitives'
import type { LedgerSnapshot } from '../operation/ledger.js'
import type { Rig, RigDevice } from '../rig.js'

type Availability = Device['availability']

interface Facts {
  readonly commandsEnabled: boolean
  readonly indiConnected: boolean
  readonly name: Reading.Reading<string>
  readonly connected: Reading.Reading<boolean>
  readonly settingUp: boolean
  readonly busy: boolean
}

/** Why a device can't take a command now, in order of precedence. */
function availabilityOf(facts: Facts): Availability {
  const not = (reason: Exclude<Availability, { ready: true }>['reason'], message: string): Availability => ({ ready: false, reason, message })

  if (!facts.commandsEnabled) return not('commands-disabled', 'Commands are disabled in the Cria configuration')
  if (!facts.indiConnected || facts.name.status === 'unavailable') return not('unavailable', 'indiserver or the driver is not available')
  if (facts.connected.status !== 'unavailable' && facts.connected.value === false) return not('disconnected', 'The device is disconnected')
  if (facts.connected.status !== 'fresh' || facts.name.status !== 'fresh') return not('stale', 'The device reports a problem with its connection')
  if (facts.settingUp) return not('starting', 'Waiting for device setup')
  if (facts.busy) return not('busy', 'An operation is running on this device')

  return { ready: true }
}

export function projectDevice(rig: Rig, device: RigDevice, busy: boolean) {
  return Effect.gen(function* () {
    const indi = yield* rig.client.status
    const body = yield* device.capability.observe
    const availability = availabilityOf({
      commandsEnabled: rig.config.commandsEnabled,
      indiConnected: indi.kind === 'connected',
      name: body.readings.name,
      connected: body.readings.connected,
      settingUp: (yield* device.setup.current) === undefined,
      busy,
    })

    return {
      id: device.config.id,
      name: device.config.indiDevice,
      availability,
      ...body,
    } satisfies Device
  })
}

export function projectState(rig: Rig, snapshot: LedgerSnapshot) {
  return Effect.gen(function* () {
    const generatedAt = Date.now()
    const devices = yield* Effect.forEach(rig.devices, device => projectDevice(rig, device, snapshot.busy(device.config.id)))

    const state: State = {
      protocolVersion,
      instanceId: rig.instanceId,
      sequence: snapshot.sequence,
      generatedAt,
      commandsEnabled: rig.config.commandsEnabled,
      devices,
      operations: snapshot.operations,
    }

    return state
  })
}
