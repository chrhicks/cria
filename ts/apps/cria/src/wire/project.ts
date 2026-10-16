/**
 * View: Readings and the ledger's facts projected into protocol 5
 * (docs/ts/SPEC.md, "The wire"). Every value here is typed by @cria/wire, so
 * the compiler checks the projection against the contract Vela imports.
 * Readings pass through as the capabilities produce them; what this module
 * decides is availability and afterOperation.
 */
import { Effect } from 'effect'
import type { Device, OperationId, State } from '@cria/wire'
import { protocolVersion } from '@cria/wire'
import type { Reading } from '@cria/primitives'
import type { DomainFacts, LedgerSnapshot } from '../operation/ledger.js'
import type { Rig, RigDevice } from '../rig.js'

type Availability = Device['availability']

/**
 * The latest settled operation in the domain that the driver was read after
 * (a liveness read that started after it settled), or null. Vela waits for its
 * own operation's ID here before treating readings as the result of its write.
 */
function afterOperation(facts: DomainFacts, confirmedAt: number | undefined): OperationId | null {
  if (confirmedAt === undefined) return null
  const read = facts.recentlySettled.filter(settled => settled.settledAt <= confirmedAt)

  return read.at(-1)?.id ?? null
}

interface Facts {
  readonly commandsEnabled: boolean
  readonly held: DomainFacts['quarantine']
  readonly indiConnected: boolean
  readonly name: Reading.Reading<string>
  readonly connected: Reading.Reading<boolean>
  readonly everRead: boolean
  readonly settingUp: boolean
  readonly busy: boolean
  readonly reReadAfterLastOperation: boolean
}

/** Why a device can't take a command now, in order of precedence. */
function availabilityOf(facts: Facts): Availability {
  const not = (reason: Exclude<Availability, { ready: true }>['reason'], message: string): Availability => ({ ready: false, reason, message })

  if (!facts.commandsEnabled) return not('commands-disabled', 'Commands are disabled in the Cria configuration')
  if (facts.held.held) return not('blocked', `Blocked until a person recovers it: ${facts.held.reason}`)
  if (!facts.indiConnected || facts.name.status === 'unavailable') return not('unavailable', 'indiserver or the driver is not available')
  if (!facts.everRead) return not('starting', 'Waiting for the first reading')
  if (facts.connected.status !== 'unavailable' && facts.connected.value === false) return not('disconnected', 'The device is disconnected')
  if (facts.connected.status !== 'fresh' || facts.name.status !== 'fresh') return not('stale', 'The driver is not answering')
  if (facts.settingUp) return not('starting', 'Waiting for device setup')
  if (facts.busy) return not('busy', 'An operation is running on this device')
  if (!facts.reReadAfterLastOperation) return not('refreshing', 'Waiting for a reading after the last operation')

  return { ready: true }
}

export function projectDevice(rig: Rig, device: RigDevice, facts: DomainFacts) {
  return Effect.gen(function* () {
    const liveness = yield* device.liveness.state
    const indi = yield* rig.client.status
    const lastSettled = facts.recentlySettled.at(-1)
    const after = afterOperation(facts, liveness.confirmedAt)
    const body = yield* device.capability.observe
    const availability = availabilityOf({
      commandsEnabled: rig.config.commandsEnabled,
      held: facts.quarantine,
      indiConnected: indi.kind === 'connected',
      name: body.readings.name,
      connected: body.readings.connected,
      everRead: liveness.confirmedAt !== undefined,
      settingUp: (yield* device.setup.current) === undefined,
      busy: facts.busy,
      reReadAfterLastOperation: lastSettled === undefined || after === lastSettled.id,
    })

    return {
      id: device.config.id,
      name: device.config.indiDevice,
      bindingId: facts.binding,
      failureDomain: device.failureDomain,
      quarantine: facts.quarantine,
      afterOperation: after,
      availability,
      ...body,
    } satisfies Device
  })
}

export function projectState(rig: Rig, snapshot: LedgerSnapshot) {
  return Effect.gen(function* () {
    const generatedAt = Date.now()
    const devices = yield* Effect.forEach(rig.devices, device => projectDevice(rig, device, snapshot.facts(device.failureDomain)))

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
