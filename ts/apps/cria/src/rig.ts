/**
 * Composition: the one place that shows what is connected to what.
 */
import { Effect, Schedule, Scope, Stream } from 'effect'
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
    const timing = { acknowledgeMs: config.acknowledgeMs, operationTimeoutMs: config.operationTimeoutMs }
    const devices: RigDevice[] = []

    for (const deviceConfig of config.devices) {
      const indi = client.device(deviceConfig.indiDevice)
      const definitions = yield* trackDefinitions(indi)
      const context: CapabilityContext = {
        device: indi,
        snapshot: takeSnapshot(indi, definitions, client.status),
        timing,
      }
      const setup = yield* makeDeviceSetup(context, deviceConfig)

      const equipment = equip(deviceConfig, context, config.initializeTimeoutMs, setup)

      devices.push({
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
      history: config.operationHistory,
      onSettled: operation => {
        recorder?.operation(operation)
        stream?.settled(operation)
      },
      devices: devices.map(device => ({
        id: device.config.id,
        kind: device.config.kind,
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

    for (const device of devices) {
      if (!device.setup.hasSteps) continue
      yield* Effect.forkScoped(Stream.runForEach(device.indi.events, event => (endsSession(event) ? device.setup.endSession : Effect.void)))
      if (config.commandsEnabled) yield* Effect.forkScoped(keepSetUp(device, ledger, instanceId))
    }

    return { instanceId, config, client, devices, ledger, images, recorder }
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
    const submitted = yield* ledger.submit({
      instanceId,
      requestId: mint.setupRequestId(),
      deviceId: device.config.id,
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
