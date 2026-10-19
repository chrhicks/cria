/**
 * Composition: the recording of INDI traffic. Opens the recorder when the
 * config asks for one and closes it with the rig's scope.
 */
import { Effect, Option, Scope } from 'effect'
import { openRecorder, type Recorder, type RecordingFiles } from '@cria/recording'
import type { InstanceId } from '@cria/wire'
import type { Config } from './config.js'

export interface RecordingOptions {
  /** How long opening or closing may wait for a stalled disk before Cria goes on without the recording. Default 5000. */
  readonly budgetMs?: number
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

  // Set when opening gave up: a recorder that opens after that has no user and is let go at once.
  const state = { gaveUp: false }
  const open = Effect.tryPromise(async () => {
    const recorder = await openRecorder(
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
    )

    if (state.gaveUp) recorder.abandon()

    return recorder
  })
  const budget = options.budgetMs ?? 5000

  return Effect.gen(function* () {
    const opened = Option.flatten(yield* Effect.option(Effect.timeoutOption(open, budget)))

    if (Option.isNone(opened)) {
      state.gaveUp = true
      yield* Effect.logWarning(`recording is configured for ${record.dir} but did not open within ${budget} ms or failed; this run is not recorded`)

      return undefined
    }

    const recorder = opened.value

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Effect.timeoutOption(Effect.promise(() => recorder.close()), budget), closed =>
        Option.isSome(closed) ? Effect.void : Effect.sync(() => recorder.abandon()),
      ),
    )

    return recorder
  })
}
