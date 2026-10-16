/**
 * Composition: the one place that shows what is connected to what.
 */
import { Effect, Option, Schedule, Scope, Stream } from 'effect'
import { makeIndiClient, type DeviceEvent, type IndiClient, type IndiDevice } from '@cria/indi'
import type { FailureDomain, InstanceId } from '@cria/wire'
import type { CapabilityContext } from './capability/context.js'
import { switchElement, takeSnapshot } from './capability/fields.js'
import { makeLiveness, type Liveness } from './capability/liveness.js'
import { makeDeviceSetup, type DeviceSetup } from './capability/setup.js'
import type { Config, DeviceConfig } from './config.js'
import { equip, type Equipment } from './device.js'
import { mint } from './ids.js'
import { makeImageStore, type ImageStore } from './image/store.js'
import { makeLedger, type Ledger } from './operation/ledger.js'
import { makeWorkflows, workflowFor } from './operation/workflows.js'

export interface RigDevice extends Equipment {
  readonly config: DeviceConfig
  readonly failureDomain: FailureDomain
  readonly indi: IndiDevice
  readonly liveness: Liveness
  readonly setup: DeviceSetup
}

export interface Rig {
  readonly instanceId: InstanceId
  readonly config: Config
  readonly client: IndiClient
  readonly devices: ReadonlyArray<RigDevice>
  readonly ledger: Ledger
  readonly images: ImageStore
}

export function makeRig(config: Config): Effect.Effect<Rig, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const instanceId = mint.instanceId()
    const client = yield* makeIndiClient(config.indi)
    const images = yield* makeImageStore({ directory: config.imageDirectory, budgetBytes: config.imageBudgetBytes })
    const timing = { acknowledgeMs: config.acknowledgeMs, operationTimeoutMs: config.operationTimeoutMs, readoutAllowanceMs: config.readoutAllowanceMs }
    const devices: RigDevice[] = []

    for (const deviceConfig of config.devices) {
      const indi = client.device(deviceConfig.indiDevice)
      const liveness = yield* makeLiveness(indi, config.livenessMs)
      const context: CapabilityContext = {
        device: indi,
        snapshot: takeSnapshot(indi, liveness, client.status),
        timing,
      }
      const setup = yield* makeDeviceSetup(context, deviceConfig)

      devices.push({
        config: deviceConfig,
        failureDomain: deviceConfig.failureDomain,
        indi,
        liveness,
        setup,
        ...equip(deviceConfig, context, config.initializeTimeoutMs, setup),
      })
    }

    const workflows = makeWorkflows(images)
    const ledger = yield* makeLedger({
      instanceId,
      commandsEnabled: config.commandsEnabled,
      history: config.operationHistory,
      devices: devices.map(device => ({
        id: device.config.id,
        kind: device.config.kind,
        name: device.config.indiDevice,
        failureDomain: device.failureDomain,
        work: workflowFor(device, workflows),
      })),
    })

    // The Pegasus weather and switch are one INDI device: connect it once.
    const preparing = new Set<string>()

    for (const device of devices) {
      if (!device.config.connect || preparing.has(device.config.indiDevice)) continue
      preparing.add(device.config.indiDevice)
      yield* Effect.forkScoped(prepare(device, ledger, config, instanceId))
    }

    for (const device of devices) {
      if (!device.setup.hasSteps) continue
      yield* Effect.forkScoped(Stream.runForEach(device.indi.events, event => (endsSession(event) ? device.setup.endSession : Effect.void)))
      if (config.commandsEnabled) yield* Effect.forkScoped(keepSetUp(device, ledger, instanceId))
    }

    return { instanceId, config, client, devices, ledger, images }
  })
}

/**
 * Start-up, for devices configured with `connect`: once the driver has defined
 * the device, connect it (setting its serial port first if configured) as an
 * ordinary device-connect operation through the ledger (review R1-#11). So it
 * is single-flight with Vela's operations, quarantines the device if it ends
 * uncertain, and shows in the operation list. Never retried.
 */
function prepare(device: RigDevice, ledger: Ledger, config: Config, instanceId: InstanceId) {
  const indi = device.indi
  const defined = Effect.gen(function* () {
    while (Option.isNone(yield* indi.property('CONNECTION'))) yield* Effect.sleep('100 millis')
  })

  return Effect.gen(function* () {
    const found = yield* Effect.timeoutOption(defined, config.initializeTimeoutMs)

    if (Option.isNone(found)) {
      yield* Effect.logWarning(`${indi.name}: not defined by indiserver within ${config.initializeTimeoutMs} ms; not connecting`)

      return
    }

    const settled = yield* Effect.result(connectAndSetUp(device, ledger, instanceId))

    if (settled._tag === 'Failure') {
      yield* Effect.logWarning(`${indi.name}: start-up connect not admitted: ${settled.failure.message}`)

      return
    }

    const outcome = settled.success

    yield* Effect.logInfo(`${indi.name}: start-up connect ${outcome.kind}${'message' in outcome ? `: ${outcome.message}` : ''}`)
  })
}

function endsSession(event: DeviceEvent): boolean {
  if (event.type === 'deleted') return event.name === undefined
  if (event.type === 'connection') return event.status.kind !== 'connected'

  return event.type === 'property' && event.property.name === 'CONNECTION' && event.property.state !== 'Busy' && switchElement('CONNECT')(event.property) === false
}

/** device-connect with `connected: true` connects the device if it is not, then runs its setup steps. */
function connectAndSetUp(device: RigDevice, ledger: Ledger, instanceId: InstanceId) {
  return Effect.gen(function* () {
    const { binding } = yield* ledger.facts(device.config.id)
    const submitted = yield* ledger.submit({
      instanceId,
      requestId: mint.startupRequestId(),
      deviceId: device.config.id,
      bindingId: binding,
      expectedName: device.config.indiDevice,
      kind: 'device-connect',
      parameters: { connected: true },
    })

    return (yield* Effect.orDie(ledger.awaitSettled(submitted.id))).outcome
  })
}

function keepSetUp(device: RigDevice, ledger: Ledger, instanceId: InstanceId) {
  const attempt = Effect.gen(function* () {
    if (!(yield* device.setup.due)) return

    const outcome = yield* connectAndSetUp(device, ledger, instanceId)

    yield* Effect.logInfo(`${device.indi.name}: setup ${outcome.kind}${'message' in outcome ? `: ${outcome.message}` : ''}`)
  })

  return Effect.forever(Effect.retry(Effect.andThen(Effect.sleep('250 millis'), attempt), Schedule.forever))
}
