import { Deferred, Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { DeviceId, InstanceId, RequestId } from '@cria/wire'
import { makeLedger, type LedgerDevice } from './ledger.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const instanceId = InstanceId.make(uuid(1))
const confirmed = { values: {}, image: null }

function device(id: string, work: LedgerDevice['work']): LedgerDevice {
  return { id: DeviceId.make(id), kind: 'camera', work }
}

describe('onSettled', () => {
  it('announces every operation exactly once, even when settling prunes the oldest from the ledger at once', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>()
          const started = yield* Deferred.make<void>()
          const announced: string[] = []
          const ledger = yield* makeLedger({
            instanceId,
            commandsEnabled: true,
            history: 10,
            onSettled: operation => void announced.push(operation.requestId),
            devices: [
              device('slow', () => Effect.andThen(Deferred.succeed(started, undefined), Effect.andThen(Deferred.await(release), Effect.succeed(confirmed)))),
              device('quick', () => Effect.succeed(confirmed)),
            ],
          })
          const submit = (deviceId: string, name: string) =>
            Effect.gen(function* () {
              yield* ledger.submit({
                instanceId,
                requestId: RequestId.make(name),
                deviceId: DeviceId.make(deviceId),
                kind: 'capture',
                parameters: { exposureSeconds: 1, light: true },
              })
              while (!announced.includes(name)) yield* Effect.sleep('1 millis')
            })
          yield* ledger.submit({
            instanceId,
            requestId: RequestId.make('slow'),
            deviceId: DeviceId.make('slow'),
            kind: 'capture',
            parameters: { exposureSeconds: 1, light: true },
          })
          yield* Deferred.await(started)

          for (let n = 0; n < 10; n += 1) yield* submit('quick', `quick-${n}`)
          yield* Deferred.succeed(release, undefined)
          while (announced.length < 11) yield* Effect.sleep('5 millis')

          expect([...announced].sort()).toEqual([...Array.from({ length: 10 }, (_, n) => `quick-${n}`), 'slow'].sort())
        }),
      ),
    ))
})
