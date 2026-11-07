import { FakeIndi, connection } from '../../testing/fake-indi/index.ts'
import { Effect, Option, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { propertyOf } from '../../testing/property.ts'
import { makeIndiClient, type DeviceEvent } from './client.ts'

const camera = 'Fake CCD'

const waitFor = <A>(effect: Effect.Effect<Option.Option<A>>) =>
  Effect.gen(function* () {
    while (true) {
      const found = yield* effect

      if (Option.isSome(found)) return found.value
      yield* Effect.sleep('20 millis')
    }
  }).pipe(Effect.timeout('5 seconds'))

describe('the property mirror and a new connection', () => {
  it('forgets what indiserver defined once the connection ends, and tells subscribers', async () => {
    const first = new FakeIndi()

    await first.start()
    first.define(connection(camera))

    const second = new FakeIndi()
    const events: Array<DeviceEvent> = []

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeIndiClient({ host: '127.0.0.1', port: first.port })
          const device = client.device(camera)

          yield* Effect.forkScoped(Stream.runForEach(device.events, event => Effect.sync(() => void events.push(event))))
          yield* waitFor(propertyOf(device, 'CONNECTION'))

          yield* Effect.promise(() => first.stop())
          yield* waitFor(client.status.pipe(Effect.map(Option.liftPredicate(status => status.kind !== 'connected'))))
          const whileDown = yield* device.properties

          yield* Effect.promise(() => second.start(first.port))
          yield* waitFor(client.status.pipe(Effect.map(Option.liftPredicate(status => status.kind === 'connected'))))
          yield* Effect.sleep('100 millis')

          return { whileDown, afterReconnect: yield* device.properties, connection: yield* propertyOf(device, 'CONNECTION') }
        }),
      ),
    )

    await second.stop()

    expect(result.whileDown).toEqual([])
    expect(result.afterReconnect).toEqual([])
    expect(Option.isNone(result.connection)).toBe(true)
    expect(events).toContainEqual({ type: 'deleted' })
  })
})
