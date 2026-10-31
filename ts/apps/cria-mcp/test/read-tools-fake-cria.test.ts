import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { callTool, callToolRaw, freePort, json, startFakeCria, startMcp, type FakeHandler } from './support.js'
import { confirmed, decodesAsImage, decodesAsWire, failed, imageOf, instanceId, notFound, operationId, requestId, running } from './fixtures.js'

const settledBody = confirmed(imageOf(Buffer.from('frame')))
const opPath = `/v2/operations/${operationId}`

const against = (handler: FakeHandler, env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const cria = yield* startFakeCria(handler)
    const mcp = yield* startMcp({ CRIA_URL: cria.origin, CRIA_REPLY_TIMEOUT: '2 seconds', ...env })

    return { cria, mcp }
  })

const routes = (table: Record<string, () => { status: number; body: unknown }>): FakeHandler => (request, response) => {
  const answer = table[request.url ?? '']?.()

  if (answer === undefined) return json(response, 404, notFound)
  json(response, answer.status, answer.body)
}

describe('the fixtures', () => {
  it('are shapes the wire accepts', () => {
    expect(() => [running, settledBody, failed].forEach(decodesAsWire)).not.toThrow()
    expect(() => decodesAsImage(imageOf(Buffer.from('frame')))).not.toThrow()
  })
})

describe('operation against a fake Cria', () => {
  it.live('answers with the operation Cria sent, unchanged', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: settledBody }) }))
      const result = yield* callTool(mcp.url, 'operation', { operationId })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ kind: 'answered', body: settledBody })
      expect(cria.requests.map(request => `${request.method} ${request.url}`)).toEqual([`GET ${opPath}`])
    }),
  )

  it.live('passes an outcome that is not confirmed through unchanged', () =>
    Effect.gen(function* () {
      const { mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: failed }) }))
      const result = yield* callTool(mcp.url, 'operation', { operationId })

      expect(result.structuredContent).toEqual({ kind: 'answered', body: failed })
    }),
  )

  it.live("passes Cria's refusal for an unknown id through with its status and body unchanged", () =>
    Effect.gen(function* () {
      const { mcp } = yield* against(routes({}))
      const result = yield* callTool(mcp.url, 'operation', { operationId })

      expect(result.structuredContent).toEqual({ kind: 'refused', status: 404, body: notFound })
    }),
  )

  it.live('is lost when Cria answers with a body that is not an operation', () =>
    Effect.gen(function* () {
      const { mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: { id: operationId } }) }))
      const result = yield* callTool(mcp.url, 'operation', { operationId })

      expect(result.structuredContent).toMatchObject({ kind: 'lost', route: `GET ${opPath}`, why: 'not-protocol-5' })
    }),
  )

  it.live('is lost on a timeout, and on a transport failure', () =>
    Effect.gen(function* () {
      const silent = yield* against(() => undefined, { CRIA_REPLY_TIMEOUT: '300 millis' })
      const port = yield* freePort
      const nothing = yield* startMcp({ CRIA_URL: `http://127.0.0.1:${port}` })

      expect((yield* callTool(silent.mcp.url, 'operation', { operationId })).structuredContent).toMatchObject({ kind: 'lost', why: 'timeout' })
      expect((yield* callTool(nothing.url, 'operation', { operationId })).structuredContent).toMatchObject({ kind: 'lost', why: 'transport' })
    }),
  )

  it.live('refuses an id that is not a UUID as input, before it reaches Cria', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(routes({}))
      const message = yield* callToolRaw(mcp.url, 'operation', { operationId: '../state' })

      expect(message?.error ?? message?.result?.isError).toBeTruthy()
      expect(cria.requests).toEqual([])
    }),
  )
})

describe('request against a fake Cria', () => {
  const path = `/v2/requests/${instanceId}/${encodeURIComponent('a request/with a slash')}`

  it.live('asks by instanceId and requestId, encoding the requestId, and returns the operation unchanged', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(routes({ [path]: () => ({ status: 200, body: running }) }))
      const result = yield* callTool(mcp.url, 'request', { instanceId, requestId: 'a request/with a slash' })

      expect(result.structuredContent).toEqual({ kind: 'answered', body: running })
      expect(cria.requests.map(request => request.url)).toEqual([path])
    }),
  )

  it.live('returns Cria\'s not-found unchanged when Cria never admitted the request', () =>
    Effect.gen(function* () {
      const { mcp } = yield* against(routes({}))
      const refusal = { error: { code: 'not-found', message: 'No such request' }, instanceId }
      const refused = yield* against((_, response) => json(response, 404, refusal))
      const result = yield* callTool(refused.mcp.url, 'request', { instanceId, requestId })

      expect(result.structuredContent).toEqual({ kind: 'refused', status: 404, body: refusal })
      void mcp
    }),
  )
})

describe('wait against a fake Cria', () => {
  it.live('returns at once when the operation is already settled, with one read', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: settledBody }) }))
      const started = Date.now()
      const result = yield* callTool(mcp.url, 'wait', { operationId, maxSeconds: 30 })

      expect(result.structuredContent).toEqual({ kind: 'answered', body: settledBody })
      expect(cria.requests).toHaveLength(1)
      expect(Date.now() - started).toBeLessThan(5000)
    }),
  )

  it.live('returns when the operation settles between two reads', () =>
    Effect.gen(function* () {
      let reads = 0
      const { cria, mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: ++reads < 3 ? running : settledBody }) }))
      const result = yield* callTool(mcp.url, 'wait', { operationId, maxSeconds: 10 })

      expect(result.structuredContent).toEqual({ kind: 'answered', body: settledBody })
      expect(cria.requests).toHaveLength(3)
    }),
  )

  it.live('returns the last read, still running, once maxSeconds have passed', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: running }) }))
      const started = Date.now()
      const result = yield* callTool(mcp.url, 'wait', { operationId, maxSeconds: 1 })
      const took = Date.now() - started

      expect(result.structuredContent).toEqual({ kind: 'answered', body: running })
      expect(cria.requests.length).toBeGreaterThanOrEqual(2)
      expect(took).toBeGreaterThanOrEqual(900)
      expect(took).toBeLessThan(4000)
    }),
  )

  it.live('stops on the first failed read and returns that failure', () =>
    Effect.gen(function* () {
      let reads = 0
      const { cria, mcp } = yield* against((_, response) => (++reads < 2 ? json(response, 200, running) : json(response, 404, notFound)))
      const result = yield* callTool(mcp.url, 'wait', { operationId, maxSeconds: 30 })

      expect(result.structuredContent).toEqual({ kind: 'refused', status: 404, body: notFound })
      expect(cria.requests).toHaveLength(2)
    }),
  )

  it.live.each([[0], [46], [1.5], [-1], ['45']])('refuses maxSeconds %s as input, before it reaches Cria', maxSeconds =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(routes({ [opPath]: () => ({ status: 200, body: running }) }))
      const message = yield* callToolRaw(mcp.url, 'wait', { operationId, maxSeconds })

      expect(message?.error ?? message?.result?.isError).toBeTruthy()
      expect(cria.requests).toEqual([])
    }),
  )

  it.live('lists maxSeconds as an integer from 1 to 45', () =>
    Effect.gen(function* () {
      const { mcp } = yield* against(routes({}))
      const { mcpClient } = yield* Effect.promise(() => import('./support.js'))
      const client = mcpClient(mcp.url)

      yield* client.initialize
      const listed = yield* client.listTools
      const wait = (listed.message?.result.tools as Array<{ name: string; inputSchema: any }>).find(tool => tool.name === 'wait')!

      expect(wait.inputSchema.properties.maxSeconds).toMatchObject({ type: 'integer', minimum: 1, maximum: 45 })
      expect(wait.inputSchema.required).toEqual(['operationId'])
    }),
  )
})
