/**
 * What Cria itself sends for images (camera.ts: `enableBlobs('Also')` before an exposure, `enableBlobs('Never')`
 * in its finalizer) does the same through the fake INDI server as through a real indiserver. The same Cria
 * client code runs the same two exposures against indi_simulator_ccd and against a FakeIndi camera that
 * delivers images the way indi-replay does, and what the client saw is compared. No equipment.
 */
import { Effect, Option } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera } from '@cria/fake-indi'
import { makeIndiClient } from '../packages/indi/src/client.js'
import type { TappedMessage } from '../packages/indi/src/tap.js'
import { startIndiServer, type RunningIndiServer } from './indiserver.js'

const device = 'CCD Simulator'
const exposureSeconds = 0.05

interface Session {
  /** Images that arrived during the exposure taken after `enableBlobs('Also')`. */
  readonly imagesWithAlso: number
  /** Images that arrived during the exposure taken after `enableBlobs('Never')`. */
  readonly imagesAfterNever: number
  /** Both exposures reached Ok. */
  readonly finished: boolean
  /** Every `enableBLOB` the client wrote. */
  readonly enableBlobWrites: ReadonlyArray<string>
}

const waitFor = <A>(effect: Effect.Effect<Option.Option<A>>) =>
  Effect.gen(function* () {
    while (true) {
      const found = yield* effect

      if (Option.isSome(found)) return found.value
      yield* Effect.sleep('20 millis')
    }
  }).pipe(Effect.timeout('10 seconds'))

function session(port: number): Promise<Session> {
  const writes: string[] = []
  const tap = {
    message: (message: TappedMessage) => void (message.dir === 'out' && message.xml.startsWith('<enableBLOB') && writes.push(message.xml.trim())),
    connection: () => undefined,
  }

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* makeIndiClient({ host: '127.0.0.1', port, tap })
        const camera = client.device(device)

        yield* waitFor(camera.property('CONNECTION'))
        yield* camera.send('CONNECTION', { CONNECT: true, DISCONNECT: false })
        yield* waitFor(camera.property('CCD_EXPOSURE'))
        yield* waitFor(camera.property('CCD1'))

        const exposure = (mode: 'Also' | 'Never') =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* camera.enableBlobs(mode)
              const subscription = yield* camera.subscribe
              let images = 0
              let finished = false

              yield* camera.send('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: exposureSeconds })
              while (!finished) {
                const event = yield* subscription.next

                if (event.type === 'blob') images += 1
                if (event.type === 'property' && event.property.name === 'CCD_EXPOSURE' && event.property.state === 'Ok') finished = true
              }
              // An image that would follow the Ok has to arrive within this quiet period to be counted.
              while (true) {
                const late = yield* subscription.next.pipe(Effect.timeoutOption('700 millis'))

                if (Option.isNone(late)) break
                if (late.value.type === 'blob') images += 1
              }

              return images
            }),
          ).pipe(Effect.timeout('20 seconds'))

        const imagesWithAlso = yield* exposure('Also')
        const imagesAfterNever = yield* exposure('Never')

        return { imagesWithAlso, imagesAfterNever, enableBlobWrites: writes }
      }),
    ),
  )
}

let indi: RunningIndiServer
let fake: FakeIndi

beforeAll(async () => {
  indi = await startIndiServer(['indi_simulator_ccd'])
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, device)
  fake.vector(device, 'CONNECTION').elements.CONNECT!.value = false
  fake.vector(device, 'CONNECTION').elements.DISCONNECT!.value = true
  fake.behaviour = (fake, vector, values) => {
    if (vector.name !== 'CCD_EXPOSURE') return 'default'
    fake.update(device, 'CCD_EXPOSURE', { state: 'Busy', values: { CCD_EXPOSURE_VALUE: Number(values.CCD_EXPOSURE_VALUE) } })
    setTimeout(() => {
      void fake.deliverBlob(device, 'CCD1', 'CCD1', Buffer.from('pixels')).then(() => fake.update(device, 'CCD_EXPOSURE', { state: 'Ok', values: { CCD_EXPOSURE_VALUE: 0 } }))
    }, exposureSeconds * 1000)

    return 'handled'
  }
})

afterAll(async () => {
  await fake.stop()
  await indi.stop()
})

describe('Cria enableBlobs Also before an exposure and Never after', () => {
  it('delivers the image only to the exposure taken under Also, on a real indiserver and through the fake alike', async () => {
    const real = await session(indi.port)
    const faked = await session(fake.port)

    expect(real).toEqual({
      imagesWithAlso: 1,
      imagesAfterNever: 0,
      enableBlobWrites: [`<enableBLOB device="${device}">Also</enableBLOB>`, `<enableBLOB device="${device}">Never</enableBLOB>`],
    })
    expect(faked).toEqual(real)
  }, 60_000)
})
