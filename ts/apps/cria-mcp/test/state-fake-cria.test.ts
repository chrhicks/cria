import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { callState, freePort, json, startFakeCria, startMcp, type FakeHandler } from './support.js'

const instanceId = '6f1b2b0e-5b8c-4a6e-9c3e-0d2f6a1d7c11'
const emptyState = { protocolVersion: 5, instanceId, sequence: 3, generatedAt: 1_793_361_600_000, commandsEnabled: false, devices: [], operations: [] }
const refusal = { error: { code: 'unauthorized', message: 'Bearer token required' }, instanceId }

const against = (handler: FakeHandler, env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const cria = yield* startFakeCria(handler)
    const mcp = yield* startMcp({ CRIA_URL: cria.origin, CRIA_REPLY_TIMEOUT: '2 seconds', ...env })

    return { cria, result: yield* callState(mcp.url) }
  })

describe('state against a fake Cria', () => {
  it.live('answers with the state Cria sent', () =>
    Effect.gen(function* () {
      const { cria, result } = yield* against((_, response) => json(response, 200, emptyState))

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ kind: 'answered', body: emptyState })
      expect(cria.requests.map(request => `${request.method} ${request.url}`)).toEqual(['GET /v2/state'])
    }),
  )

  it.live('sends no Origin and no Authorization when no token is set', () =>
    Effect.gen(function* () {
      const { cria } = yield* against((_, response) => json(response, 200, emptyState))
      const sent = cria.requests[0]!.headers

      expect(sent.origin).toBeUndefined()
      expect(sent.authorization).toBeUndefined()
    }),
  )

  it.live('sends the bearer token when one is set, and never returns it', () =>
    Effect.gen(function* () {
      const { cria, result } = yield* against((_, response) => json(response, 200, emptyState), { CRIA_TOKEN: 'a-test-token' })

      expect(cria.requests[0]!.headers.authorization).toBe('Bearer a-test-token')
      expect(JSON.stringify(result)).not.toContain('a-test-token')
    }),
  )

  it.live("passes Cria's refusal through with its status and body unchanged", () =>
    Effect.gen(function* () {
      const { result } = yield* against((_, response) => json(response, 401, refusal))

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ kind: 'refused', status: 401, body: refusal })
    }),
  )

  it.live('refuses to start when CRIA_URL carries credentials, and does not print them', () =>
    Effect.gen(function* () {
      const failure = yield* startMcp({ CRIA_URL: 'http://fixture-user:fixture-password@127.0.0.1:9' }).pipe(Effect.flip)

      expect(failure.message).toContain('must not carry credentials')
      expect(failure.message).not.toContain('fixture-password')
    }),
  )

  describe('lost: no readable protocol 5 answer', () => {
    const lost = (result: { structuredContent?: any }, why: string, ...fragments: string[]) => {
      expect(result.structuredContent).toMatchObject({ kind: 'lost', route: 'GET /v2/state', why })
      for (const fragment of fragments) expect(result.structuredContent.message).toContain(fragment)
    }

    it.live('timeout: Cria does not answer within the reply timeout', () =>
      Effect.gen(function* () {
        const { result } = yield* against(() => undefined, { CRIA_REPLY_TIMEOUT: '300 millis' })

        lost(result, 'timeout')
      }),
    )

    it.live('timeout: Cria sends the head and stalls the body', () =>
      Effect.gen(function* () {
        const { result } = yield* against((_, response) => void response.writeHead(200, { 'content-type': 'application/json' }).write('{"protoc'), { CRIA_REPLY_TIMEOUT: '300 millis' })

        lost(result, 'timeout')
      }),
    )

    it.live('transport: nothing is listening at CRIA_URL', () =>
      Effect.gen(function* () {
        const port = yield* freePort
        const mcp = yield* startMcp({ CRIA_URL: `http://127.0.0.1:${port}`, CRIA_REPLY_TIMEOUT: '2 seconds' })

        const result = yield* callState(mcp.url)

        lost(result, 'transport')
        expect(result.structuredContent.message).not.toContain(String(port))
      }),
    )

    it.live('transport: a 307 redirect is reported and not followed', () =>
      Effect.gen(function* () {
        const elsewhere = yield* startFakeCria((_, response) => json(response, 200, emptyState))
        const { result } = yield* against((_, response) => {
          response.writeHead(307, { location: `${elsewhere.origin}/v2/state` }).end()
        })

        lost(result, 'transport')
        expect(elsewhere.requests).toEqual([])
      }),
    )

    it.live('not-protocol-5: a 200 that is not a State', () =>
      Effect.gen(function* () {
        const { result } = yield* against((_, response) => json(response, 200, { hello: 'world' }))

        lost(result, 'not-protocol-5')
      }),
    )

    it.live('not-protocol-5: a State with a field the wire does not know', () =>
      Effect.gen(function* () {
        const { result } = yield* against((_, response) => json(response, 200, { ...emptyState, extra: true }))

        lost(result, 'not-protocol-5')
      }),
    )

    it.live('not-protocol-5: a 200 whose body is not JSON', () =>
      Effect.gen(function* () {
        const { result } = yield* against((_, response) => void response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>'))

        lost(result, 'not-protocol-5')
      }),
    )

    it.live('not-protocol-5: a 500 without an ErrorBody', () =>
      Effect.gen(function* () {
        const { result } = yield* against((_, response) => json(response, 500, { oops: 'no' }))

        lost(result, 'not-protocol-5', '500')
      }),
    )
  })
})
