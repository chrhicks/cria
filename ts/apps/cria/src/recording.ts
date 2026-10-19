/**
 * Composition: the recording of INDI traffic. Opens the recorder when the
 * config asks for one and closes it with the rig's scope.
 */
import { Effect, Option, Scope } from 'effect'
import { openRecorder, type Recorder, type RecordingFiles } from '@cria/recording'
import type { InstanceId } from '@cria/wire'
import type { Config } from './config.js'

export interface RecordingOptions {
  /** How long closing may wait for a stalled disk before the recording is abandoned. Default 5000. */
  readonly closeBudgetMs?: number
  /** Replaces the real disk, for tests that stall it, fill it or kill the process between two writes. */
  readonly files?: (folder: string) => Promise<RecordingFiles>
}

/**
 * Recording never stops Cria from observing: a recorder that cannot open is
 * logged and the rig runs without one, as it does when the recorder later stops.
 */
export function makeRecorder(config: Config, instanceId: InstanceId, options: RecordingOptions): Effect.Effect<Recorder | undefined, never, Scope.Scope> {
  const record = config.record

  if (!record) return Effect.succeed(undefined)

  const open = Effect.tryPromise(() =>
    openRecorder(
      { dir: record.dir, reserveBytes: record.reserveGb * 1024 ** 3, queueBytes: record.queueMb * 1024 ** 2 },
      {
        instanceId,
        indi: config.indi,
        devices: config.devices.map(device => ({ id: device.id, kind: device.kind, indiDevice: device.indiDevice })),
      },
      {
        ...(options.files ? { files: options.files } : {}),
        onLatch: (reason, cause) => Effect.runSync(Effect.logWarning(`recording stopped (${reason}) for the rest of this run: ${String(cause)}`)),
      },
    ),
  )

  return Effect.gen(function* () {
    const opened = yield* Effect.option(open)

    if (Option.isNone(opened)) {
      yield* Effect.logWarning(`recording is configured for ${record.dir} but could not open; this run is not recorded`)

      return undefined
    }

    const recorder = opened.value

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Effect.timeoutOption(Effect.promise(() => recorder.close()), options.closeBudgetMs ?? 5000), closed =>
        Option.isSome(closed) ? Effect.void : Effect.promise(() => recorder.abandon()),
      ),
    )

    return recorder
  })
}
