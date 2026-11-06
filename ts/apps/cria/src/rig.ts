/**
 * Composition: the one place that shows what is connected to what.
 */
import { Effect, Option, Schedule, Scope, Stream } from 'effect'
import { makeIndiClient, type DeviceEvent, type IndiClient, type IndiDevice, type TrafficTap } from '@cria/indi'
import type { Recorder } from '@cria/recording'
import type { FailureDomain, InstanceId } from '@cria/wire'
import type { CapabilityContext } from './capability/context.js'
import { switchElement, takeSnapshot } from './capability/fields.js'
import { trackDefinitions } from './capability/definitions.js'
import { makeDeviceSetup, type DeviceSetup } from './capability/setup.js'
import type { Config, DeviceConfig } from './config.js'
import { equip, type Equipment } from './device.js'
import { mint } from './ids.js'
import { makeImageStore, type ImageStore } from './image/store.js'
import { makeLedger, type Ledger } from './operation/ledger.js'
import { makeWorkflows, workflowFor } from './operation/workflows.js'
import { makeRecorder, type RecordingOptions } from './recording.js'
import { makeCriaStream, type OpenPublisher } from './stream.js'

export interface RigDevice extends Equipment {
  readonly feedback: CapabilityContext['feedback']
  readonly config: DeviceConfig
  readonly failureDomain: FailureDomain
  readonly indi: IndiDevice
  readonly setup: DeviceSetup
}

export interface Rig {
  readonly instanceId: InstanceId
  readonly config: Config
  readonly client: IndiClient
  readonly devices: ReadonlyArray<RigDevice>
  readonly ledger: Ledger
  readonly images: ImageStore
  /** Absent when the config has no `record`, or when it could not open. */
  readonly recorder: Recorder | undefined
}

export function makeRig(config: Config, options: { readonly recording?: RecordingOptions; readonly stream?: OpenPublisher } = {}): Effect.Effect<Rig, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const instanceId = mint.instanceId()
    const recorder = yield* makeRecorder(config, instanceId, options.recording ?? {})
    const stream = yield* makeCriaStream(config, instanceId, options.stream)
    const tap: TrafficTap = {
      message: message => {
        recorder?.message(message)
        stream?.traffic.message(message)
      },
      connection: connection => {
        recorder?.connection(connection)
        stream?.traffic.connection(connection)
      },
    }
    const client = yield* makeIndiClient({ ...config.indi, tap })
    const images = yield* makeImageStore({ directory: config.imageDirectory, budgetBytes: config.imageBudgetBytes })
    const timing = { acknowledgeMs: config.acknowledgeMs, operationTimeoutMs: config.operationTimeoutMs, readoutAllowanceMs: config.readoutAllowanceMs }
    const devices: RigDevice[] = []

    for (const deviceConfig of config.devices) {
      const indi = client.device(deviceConfig.indiDevice)
      const definitions = yield* trackDefinitions(indi)
      const context: CapabilityContext = {
        feedback: { envelope: deviceConfig.envelope ?? null, fix: null },
        device: indi,
        snapshot: takeSnapshot(indi, definitions, client.status),
        timing,
      }
      const setup = yield* makeDeviceSetup(context, deviceConfig)

      const equipment = equip(deviceConfig, context, config.initializeTimeoutMs, setup)
      if ('watchTravel' in equipment.capability) yield* Effect.forkScoped(equipment.capability.watchTravel)

      devices.push({
        feedback: context.feedback,
        config: deviceConfig,
        failureDomain: deviceConfig.failureDomain,
        indi,
        setup,
        ...equipment,
      })
    }

    const workflows = makeWorkflows(images, frame => stream?.frame(frame))
    const inner = yield* makeLedger({
      instanceId,
      commandsEnabled: config.commandsEnabled,
      mountLeaseRequired: config.mountLeaseRequired ?? false,
      history: config.operationHistory,
      onSettled: operation => {
        recorder?.operation(operation)
        stream?.settled(operation)
      },
      devices: devices.map(device => ({
        id: device.config.id,
        kind: device.config.kind,
        name: device.config.indiDevice,
        failureDomain: device.failureDomain,
        work: workflowFor(device, workflows),
      })),
    })

    const ledger: Ledger = stream
      ? {
          ...inner,
          submit: submission =>
            inner.submit(submission).pipe(
              Effect.tap(operation => Effect.sync(() => stream.accepted(submission, operation))),
              Effect.tapError(refusal => Effect.sync(() => stream.refused(submission, refusal))),
            ),
        }
      : inner

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

    return { instanceId, config, client, devices, ledger, images, recorder }
  })
}

/**
 * Start-up, for devices configured with `connect`: once the driver has defined
 * the device, connect it (setting its serial port first if configured) as an
 * ordinary device-connect operation through the ledger (review R1-#11). So it
 * is single-flight with Vela's operations, holds a mount if it ends uncertain
 * (no other kind is held), and shows in the operation list. Never retried.
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
