import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { json, mcpClient, startFakeCria, startMcp } from './support.js'

const emptyState = { protocolVersion: 5, instanceId: '6f1b2b0e-5b8c-4a6e-9c3e-0d2f6a1d7c11', sequence: 0, generatedAt: 1_793_361_600_000, commandsEnabled: false, devices: [], operations: [] }

const server = Effect.gen(function* () {
  const cria = yield* startFakeCria((_, response) => json(response, 200, emptyState))

  return yield* startMcp({ CRIA_URL: cria.origin })
})

describe('Streamable HTTP, as Executor speaks it', () => {
  it.live('initializes, lists the read tools as non-destructive with object input schemas, and calls state', () =>
    Effect.gen(function* () {
      const mcp = yield* server
      const client = mcpClient(mcp.url)
      const initialized = yield* client.initialize

      expect(initialized.status).toBe(200)
      expect(initialized.message?.result.protocolVersion).toBe('2025-11-25')
      expect(initialized.message?.result.serverInfo.name).toBe('cria')
      expect(initialized.headers.get('mcp-session-id')).not.toBeNull()

      const listed = yield* client.listTools
      const tools = listed.message?.result.tools as Array<{ name: string; inputSchema: { type: string }; annotations: Record<string, boolean> }>

      const reads = ['state', 'operation', 'wait', 'request', 'image']

      expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining(reads))
      for (const tool of tools) expect(tool.inputSchema.type, tool.name).toBe('object')
      for (const tool of tools.filter(tool => reads.includes(tool.name)))
        expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })

      const called = yield* client.callTool('state', {})

      expect(called.message?.result.isError).toBe(false)
      expect(called.message?.result.structuredContent).toEqual({ kind: 'answered', body: emptyState })
    }),
  )

  it.live('refuses a request that does not accept both JSON and event streams', () =>
    Effect.gen(function* () {
      const mcp = yield* server
      const response = yield* Effect.promise(() => fetch(mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' }))

      expect(response.status).toBe(406)
    }),
  )

  it.live('refuses a browser Origin', () =>
    Effect.gen(function* () {
      const mcp = yield* server
      const response = yield* Effect.promise(() =>
        fetch(mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'http://example.test' }, body: '{}' }),
      )

      expect(response.status).toBe(403)
    }),
  )

  it.live('listens on loopback only', () =>
    Effect.gen(function* () {
      const mcp = yield* server

      expect(new URL(mcp.url).hostname).toBe('127.0.0.1')
      expect(mcp.log()).toContain('Listening on http://127.0.0.1:')
    }),
  )
})
