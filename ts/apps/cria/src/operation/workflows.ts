/** Workflow bodies: one short body per operation kind. */
import { Effect } from 'effect'
import { Failed, type Ending, type Report } from '@cria/primitives'
import { commands, type CommandKind, type DeviceFor, type DeviceId, type DeviceKind, type ImageId, type OperationId, type OperationResult, type ParamsOf, type Progress } from '@cria/wire'
import type { Connection } from '../capability/connection.js'
import type { Note } from '../capability/motion-record.js'
import type { CapabilityOf, Equipment } from '../device.js'
import { FitsError, fitsToImageBytes, readFitsCards } from '@cria/fits'
import type { ImageStore } from '../image/store.js'
import type { Running } from './ledger.js'

type TargetOf<K extends CommandKind> = DeviceFor<K> extends DeviceKind ? CapabilityOf[DeviceFor<K>] : Connection

interface Context {
  readonly report: Report<Progress>
  readonly note: Note
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

export interface FrameKept {
  readonly operationId: OperationId
  readonly deviceId: DeviceId
  readonly imageId: ImageId
  readonly bytes: number
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly exposureSeconds: number
  readonly capturedAt: number
  readonly header: ReadonlyArray<string>
}

export function makeWorkflows(images: ImageStore, onFrame: (frame: FrameKept) => void = () => {}): Workflows {
  return {
    capture: (camera, parameters, { report, operation }) =>
      Effect.gen(function* () {
        const frame = yield* camera.capture(parameters, report)

        yield* report({ phase: 'retaining' })
        const { image, header } = yield* Effect.try({
          try: () => ({ image: fitsToImageBytes(frame.fits, frame), header: readFitsCards(frame.fits) }),
          catch: error => new Failed({ reason: 'invalid', message: error instanceof FitsError ? error.message : String(error) }),
        })
        const stored = yield* images.adopt(image.bytes)

        onFrame({
          operationId: operation.id,
          deviceId: operation.deviceId,
          imageId: stored.id,
          bytes: stored.bytes,
          sha256: stored.sha256,
          width: image.width,
          height: image.height,
          exposureSeconds: parameters.exposureSeconds,
          capturedAt: image.capturedAt ?? frame.dispatchedAt,
          header,
        })

        return {
          values: {},
          image: {
            id: stored.id,
            operationId: operation.id,
            instanceId: operation.instanceId,
            deviceId: operation.deviceId,
            cameraName: frame.cameraName,
            width: image.width,
            height: image.height,
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
    'mount-slew': (mount, parameters, { note }) => mount.slew(parameters, note).pipe(
      Effect.map(values),
      Effect.mapError(error => error._tag === 'Failed' && error.reason === 'rejected'
        ? new Failed({ reason: 'rejected', message: `${error.message}. Nothing moved. An AM5 can refuse a goto when its site and time are not synced after power-on (AM5 e7). Send device-connect with connected: true to re-send site and time, then try the goto again. If no site is configured, configure it first.` })
        : error),
    ),
    'mount-tracking': (mount, { tracking }) => mount.setTracking(tracking).pipe(Effect.map(values)),
    'mount-axis': (mount, { rateDegreesPerSecond, durationSeconds }, { note }) => mount.moveAxis(rateDegreesPerSecond, durationSeconds, note).pipe(Effect.map(values)),
    'mount-rotate': (mount, { rateDegreesPerSecond, distanceDegrees }, { note }) => mount.rotate(rateDegreesPerSecond, distanceDegrees, note).pipe(Effect.map(values)),
    'mount-home': (mount, _, { note }) => mount.home(note).pipe(Effect.map(values)),
    'mount-stop': (mount, _, { note }) => mount.stop(note).pipe(Effect.map(values)),
    'switch-set': (power, { channelId, value }) => power.set(channelId, value).pipe(Effect.map(values)),
    'device-connect': (connection, { connected }) => connection.connect(connected).pipe(Effect.map(values)),
  }
}

export function workflowFor(device: Equipment, workflows: Workflows) {
  return (operation: Running, report: Report<Progress>, note: Note) => run(operation, device, workflows, { report, note, operation })
}

function run<K extends CommandKind>(command: CommandOf[K], device: Equipment, workflows: Workflows, context: Context) {
  // Admission refused a command whose row names another device kind, so this device's capability is the row's.
  const target = (commands[command.kind].device === 'any' ? device.connection : device.capability) as TargetOf<K>

  return workflows[command.kind](target, command.parameters, context)
}
