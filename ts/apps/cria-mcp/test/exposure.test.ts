import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { commands as wire } from '@cria/wire'
import { commands, exposedKinds, routes } from '../src/exposure.js'
import { json, mcpClient, startFakeCria, startMcp } from './support.js'

interface Listed {
  readonly name: string
  readonly description: string
  readonly inputSchema: { readonly type: string; readonly properties: Record<string, any>; readonly required: ReadonlyArray<string> }
  readonly annotations: Record<string, boolean>
}

const listed = Effect.gen(function* () {
  const cria = yield* startFakeCria((_, response) => json(response, 200, {}))
  const mcp = yield* startMcp({ CRIA_URL: cria.origin })
  const client = mcpClient(mcp.url)

  yield* client.initialize

  return ((yield* client.listTools).message?.result.tools as ReadonlyArray<Listed>).reduce((byName, tool) => ({ ...byName, [tool.name]: tool }), {} as Record<string, Listed>)
})

describe('the exposure table', () => {
  it('lists only kinds the wire has, and describes every kind and route', () => {
    for (const kind of exposedKinds) {
      expect(Object.keys(wire), kind).toContain(kind)
      expect(commands[kind].description.trim(), kind).not.toBe('')
    }
    for (const [name, route] of Object.entries(routes)) expect(route.description.trim(), name).not.toBe('')
  })

  it('exposes every kind the wire has today', () => {
    expect([...exposedKinds].sort()).toEqual(Object.keys(wire).sort())
  })
})

describe('tools/list', () => {
  it.live('shows exactly the exposed kinds and the seven routes, each with an object input schema and a description', () =>
    Effect.gen(function* () {
      const tools = yield* listed

      expect(Object.keys(tools).sort()).toEqual([...exposedKinds, ...Object.keys(routes)].sort())
      expect(Object.keys(routes).sort()).toEqual(['cancel', 'image', 'operation', 'recover', 'request', 'state', 'wait'])
      for (const tool of Object.values(tools)) {
        expect(tool.inputSchema.type, tool.name).toBe('object')
        expect(tool.description.length, tool.name).toBeGreaterThan(0)
      }
      for (const kind of exposedKinds) expect(tools[kind]!.description, kind).toContain(commands[kind].description)
    }),
  )

  it.live("carries the wire's float and integer ranges into each command's parameters schema", () =>
    Effect.gen(function* () {
      const tools = yield* listed
      const parameters = (kind: string) => tools[kind]!.inputSchema.properties.parameters.properties

      expect(parameters('capture').exposureSeconds).toMatchObject({ type: 'number', minimum: 0.000001, maximum: 3600 })
      expect(parameters('mount-rotate').rateDegreesPerSecond).toMatchObject({ type: 'number', minimum: -10, maximum: 10 })
      expect(parameters('mount-rotate').distanceDegrees).toMatchObject({ type: 'number', minimum: -120, maximum: 120 })
      expect(parameters('mount-slew').rightAscensionDegrees).toMatchObject({ minimum: 0, maximum: 359.999999999 })
      expect(parameters('cooling').setpointC).toMatchObject({ minimum: -100, maximum: 100 })
      expect(parameters('focuser-move').position).toMatchObject({ type: 'integer', allOf: [{ minimum: 1, maximum: 2_147_483_646 }] })
      expect(tools['mount-rotate']!.inputSchema.required).toEqual(['instanceId', 'requestId', 'deviceId', 'bindingId', 'expectedName', 'parameters'])
    }),
  )

  it.live('takes no parameters key for a kind with no parameters, and the five identity fields for every kind', () =>
    Effect.gen(function* () {
      const tools = yield* listed
      const identity = ['instanceId', 'requestId', 'deviceId', 'bindingId', 'expectedName']

      for (const kind of exposedKinds) {
        const empty = Object.keys(wire[kind].parameters.fields).length === 0

        expect(Object.keys(tools[kind]!.inputSchema.properties), kind).toEqual(empty ? identity : [...identity, 'parameters'])
      }
    }),
  )

  it.live("sets each hint explicitly: halts and cancel are not destructive, every other change is, reads are read-only, nothing that changes the rig is idempotent", () =>
    Effect.gen(function* () {
      const tools = yield* listed

      for (const kind of exposedKinds)
        expect(tools[kind]!.annotations, kind).toEqual({ readOnlyHint: false, destructiveHint: !wire[kind].halt, idempotentHint: false, openWorldHint: false })
      expect(tools.cancel!.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })
      expect(tools.recover!.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false })
      expect(['mount-stop', 'focuser-halt'].map(kind => tools[kind]!.annotations.destructiveHint)).toEqual([false, false])
      for (const name of ['state', 'operation', 'wait', 'request', 'image'])
        expect(tools[name]!.annotations, name).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
    }),
  )
})
