import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { addCamera, addMount, FakeIndi } from '@cria/fake-indi'
import { State } from '@cria/wire'
import { makeCriaClient } from '../../../testing/cria-client.js'
import { callState, startMcp, startRealCria } from './support.js'

const fakeRig = Effect.acquireRelease(
  Effect.promise(async () => {
    const fake = new FakeIndi()

    await fake.start()
    addCamera(fake, 'Fake CCD')
    addMount(fake, 'Fake Mount')

    return fake
  }),
  fake => Effect.promise(() => fake.stop()),
)

const ready = (client: ReturnType<typeof makeCriaClient>) =>
  Effect.promise(async () => {
    let last: unknown
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await client.state()

      last = JSON.stringify(state.devices).slice(0, 600)

      if (state.devices.length === 2 && !JSON.stringify(state.devices).includes('"reason":"not-read"')) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Cria never showed every reading read: ${JSON.stringify(last)}`)
  })

describe('state against a real Cria on fake INDI', () => {
  it.live('returns the state the real Cria serves, and it decodes strictly with the wire', () =>
    Effect.gen(function* () {
      const fake = yield* fakeRig
      const cria = yield* startRealCria(fake.port)
      const direct = yield* ready(makeCriaClient(cria.origin))
      const mcp = yield* startMcp({ CRIA_URL: cria.origin })
      const result = yield* callState(mcp.url)

      expect(result.structuredContent.kind).toBe('answered')

      const body = Schema.decodeUnknownSync(State)(result.structuredContent.body, { onExcessProperty: 'error' })

      expect(body.instanceId).toBe(direct.instanceId)
      expect(body.commandsEnabled).toBe(false)
      expect(body.devices.map(device => [device.id, device.kind, device.bindingId])).toEqual(direct.devices.map(device => [device.id, device.kind, device.bindingId]))
    }),
  )

  it.live("passes the real Cria's 401 through unchanged when the server has no token", () =>
    Effect.gen(function* () {
      const fake = yield* fakeRig
      const cria = yield* startRealCria(fake.port, { token: 'a-test-token' })
      const mcp = yield* startMcp({ CRIA_URL: cria.origin })
      const result = yield* callState(mcp.url)

      expect(result.structuredContent).toMatchObject({
        kind: 'refused',
        status: 401,
        body: { error: { code: 'unauthorized', message: 'Bearer token required' } },
      })
      expect(typeof result.structuredContent.body.instanceId).toBe('string')
    }),
  )

  it.live('is accepted by the real Cria when CRIA_TOKEN is set', () =>
    Effect.gen(function* () {
      const fake = yield* fakeRig
      const cria = yield* startRealCria(fake.port, { token: 'a-test-token' })
      const mcp = yield* startMcp({ CRIA_URL: cria.origin, CRIA_TOKEN: 'a-test-token' })
      const result = yield* callState(mcp.url)

      expect(result.structuredContent.kind).toBe('answered')
    }),
  )
})
