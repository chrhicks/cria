/**
 * Composition: the one place that shows what is connected to what.
 */
import { Effect, Scope, Stream } from 'effect'
import { makeIndiClient, type DeviceEvent, type IndiClient, type IndiDevice } from '@cria/indi'
import type { InstanceId } from '@cria/wire'
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
import { makeCriaStream, type OpenPublisher } from './stream.js'

export interface RigDevice extends Equipment {
  readonly config: DeviceConfig
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
}

export function makeRig(config: Config, options: { readonly stream?: OpenPublisher } = {}): Effect.Effect<Rig, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const instanceId = mint.instanceId()
    const stream = yield* makeCriaStream(config, instanceId, options.stream)
    const client = yield* makeIndiClient({ ...config.indi, ...(stream ? { tap: stream.traffic } : {}) })
    const images = yield* makeImageStore({ directory: config.imageDirectory, budgetBytes: config.imageBudgetBytes })
    const timing = { acknowledgeMs: config.acknowledgeMs, confirmMs: config.confirmMs, stopMs: config.acknowledgeMs + config.confirmMs, operationTimeoutMs: config.operationTimeoutMs }
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

      const equipment = equip(deviceConfig, context, config.connectTimeoutMs, setup)

      devices.push({
        config: deviceConfig,
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
      onSettled: operation => stream?.settled(operation),
      devices: devices.map(device => ({
        id: device.config.id,
        kind: device.config.kind,
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
    }

    return { instanceId, config, client, devices, ledger, images }
  })
}

function endsSession(event: DeviceEvent): boolean {
  if (event.type === 'deleted') return event.name === undefined
  if (event.type === 'connection') return event.status.kind !== 'connected'

  return event.type === 'property' && event.property.name === 'CONNECTION' && event.property.state !== 'Busy' && switchElement('CONNECT')(event.property) === false
}
