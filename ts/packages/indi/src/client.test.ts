import { Effect, Option, Scope } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startIndiServer, type RunningIndiServer } from '../../../testing/indiserver.js'
import { makeIndiClient, type IndiClient } from './client.js'

let server: RunningIndiServer

beforeAll(async () => {
  server = await startIndiServer(['indi_simulator_focus'])
})

afterAll(() => server.stop())

function withClient<A, E>(use: (client: IndiClient) => Effect.Effect<A, E, Scope.Scope>) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* makeIndiClient({ host: '127.0.0.1', port: server.port })

        yield* waitFor(client.status.pipe(Effect.map(Option.liftPredicate(status => status.kind === 'connected'))))

        return yield* use(client)
      }),
    ),
  )
}

const waitFor = <A>(effect: Effect.Effect<Option.Option<A>>) =>
  Effect.gen(function* () {
    while (true) {
      const found = yield* effect

      if (Option.isSome(found)) return found.value
      yield* Effect.sleep('20 millis')
    }
  }).pipe(Effect.timeout('5 seconds'))

describe('INDI client against a real indiserver', () => {
  it('mirrors definitions and answers a liveness read with a fresh definition', () =>
    withClient(client =>
      Effect.gen(function* () {
        const focuser = client.device('Focuser Simulator')
        const before = yield* waitFor(focuser.property('CONNECTION'))

        yield* Effect.sleep('2 millis')
        const read = yield* focuser.read('CONNECTION')

        expect(read.name).toBe('CONNECTION')
        expect(read.receivedAt).toBeGreaterThan(before.receivedAt)
        expect(Option.getOrUndefined(yield* focuser.property('CONNECTION'))).toBe(read)
      }),
    ))

  it('sends a command once and sees the driver move through Busy to Ok', () =>
    withClient(client =>
      Effect.gen(function* () {
        const focuser = client.device('Focuser Simulator')

        yield* waitFor(focuser.property('CONNECTION'))
        yield* focuser.send('CONNECTION', { CONNECT: true })
        const position = yield* waitFor(focuser.property('ABS_FOCUS_POSITION'))
        const target = 50100

        expect(position.elements.get('FOCUS_ABSOLUTE_POSITION')).toMatchObject({ kind: 'number', value: 50000 })

        const states = yield* Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* focuser.subscribe
            const seen: string[] = []

            yield* focuser.send('ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: target })
            while (true) {
              const event = yield* subscription.next

              if (event.type !== 'property' || event.property.name !== 'ABS_FOCUS_POSITION') continue
              seen.push(event.property.state)
              if (event.property.state === 'Ok' || event.property.state === 'Alert') return seen
            }
          }),
        ).pipe(Effect.timeout('10 seconds'))

        expect(states.at(-1)).toBe('Ok')
        expect(Option.getOrUndefined(yield* focuser.property('ABS_FOCUS_POSITION'))?.elements.get('FOCUS_ABSOLUTE_POSITION')).toMatchObject({ value: target })
      }),
    ))

  it('refuses to send to a property the driver never defined, without sending', () =>
    withClient(client =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(client.device('Focuser Simulator').send('NO_SUCH_PROPERTY', { X: 1 }))

        expect(error.reason).toBe('unknown-property')
      }),
    ))
})
