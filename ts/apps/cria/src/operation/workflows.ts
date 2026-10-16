/** Workflow bodies: one short body per operation kind. */
import { Effect } from 'effect'
import { Failed, type Ending, type Report } from '@cria/primitives'
import { commands, type CommandKind, type DeviceFor, type DeviceKind, type OperationResult, type ParamsOf, type Progress } from '@cria/wire'
import type { Connection } from '../capability/connection.js'
import type { CapabilityOf, Equipment } from '../device.js'
import { FitsError, fitsToImageBytes } from '../image/fits.js'
import type { ImageStore } from '../image/store.js'
import type { Running } from './ledger.js'

type TargetOf<K extends CommandKind> = DeviceFor<K> extends DeviceKind ? CapabilityOf[DeviceFor<K>] : Connection

interface Context {
  readonly report: Report<Progress>
  readonly operation: Running
}

type Workflow<K extends CommandKind> = (target: TargetOf<K>, parameters: ParamsOf<K>, context: Context) => Effect.Effect<OperationResult, Ending>

export type Workflows = { readonly [K in CommandKind]: Workflow<K> }

type CommandOf = { readonly [K in CommandKind]: { readonly kind: K; readonly parameters: ParamsOf<K> } }

type Json = OperationResult['values'][string]

const values = (result: Readonly<Record<string, Json | undefined>>): OperationResult => ({
  values: Object.fromEntries(Object.entries(result).filter((entry): entry is [string, Json] => entry[1] !== undefined)),
  image: null,
})

export function makeWorkflows(images: ImageStore): Workflows {
  return {
    capture: (camera, parameters, { report, operation }) =>
      Effect.gen(function* () {
        const frame = yield* camera.capture(parameters, report)

        yield* report({ phase: 'retaining' })
        const image = yield* Effect.try({
          try: () => fitsToImageBytes(frame.fits, frame),
          catch: error => new Failed({ reason: 'invalid', message: error instanceof FitsError ? error.message : String(error) }),
        })
        const stored = yield* images.adopt(image.bytes)

        return {
          values: {},
          image: {
            id: stored.id,
            operationId: operation.id,
            instanceId: operation.instanceId,
            deviceId: operation.deviceId,
            cameraName: operation.expectedName,
            bindingId: operation.bindingId,
            width: image.width,
            height: image.height,
            binX: frame.binX,
            binY: frame.binY,
            startX: frame.startX,
            startY: frame.startY,
            exposureSeconds: parameters.exposureSeconds,
            color: frame.color,
            capturedAt: image.capturedAt ?? frame.dispatchedAt,
            capturedAtSource: image.capturedAt === undefined ? 'server-estimate' : 'camera',
            retainedAt: stored.retainedAt,
            sha256: stored.sha256,
            original: { mediaType: 'application/imagebytes', bytes: stored.bytes, url: `/v2/images/${stored.id}/original` },
          },
        }
      }),
    'camera-configure': (camera, parameters) => camera.configure(parameters).pipe(Effect.map(values)),
    cooling: (camera, parameters) => camera.cooling(parameters).pipe(Effect.map(values)),
    'focuser-move': (focuser, parameters) => focuser.move(parameters).pipe(Effect.map(values)),
    'focuser-halt': focuser => focuser.halt.pipe(Effect.map(values)),
    'mount-slew': (mount, parameters) => mount.slew(parameters).pipe(Effect.map(values)),
    'mount-tracking': (mount, { tracking }) => mount.setTracking(tracking).pipe(Effect.map(values)),
    'mount-axis': (mount, { rateDegreesPerSecond, durationSeconds }) => mount.moveAxis(rateDegreesPerSecond, durationSeconds).pipe(Effect.map(values)),
    'mount-rotate': (mount, { rateDegreesPerSecond, distanceDegrees }) => mount.rotate(rateDegreesPerSecond, distanceDegrees).pipe(Effect.map(values)),
    'mount-home': mount => mount.home.pipe(Effect.map(values)),
    'mount-stop': mount => mount.stop.pipe(Effect.map(values)),
    'mount-park': mount => mount.park.pipe(Effect.map(values)),
    'mount-unpark': mount => mount.unpark.pipe(Effect.map(values)),
    'switch-set': (power, { channelId, value }) => power.set(channelId, value).pipe(Effect.map(values)),
    'device-connect': (connection, { connected }) => connection.connect(connected).pipe(Effect.map(values)),
  }
}

export function workflowFor(device: Equipment, workflows: Workflows) {
  return (operation: Running, report: Report<Progress>) => run(operation, device, workflows, { report, operation })
}

function run<K extends CommandKind>(command: CommandOf[K], device: Equipment, workflows: Workflows, context: Context) {
  // Admission refused a command whose row names another device kind, so this device's capability is the row's.
  const target = (commands[command.kind].device === 'any' ? device.connection : device.capability) as TargetOf<K>

  return workflows[command.kind](target, command.parameters, context)
}
