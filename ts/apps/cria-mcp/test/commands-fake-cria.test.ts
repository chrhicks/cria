import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { errorCodes } from '@cria/wire'
import { callTool, callToolRaw, freePort, json, startFakeCria, startMcp, type FakeHandler } from './support.js'
import { decodesAsDevice, decodesAsWire, instanceId, mountId, notFound, operationId, rotateInput, rotating, rotation, switchDevice } from './fixtures.js'

const against = (handler: FakeHandler, env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const cria = yield* startFakeCria(handler)
    const mcp = yield* startMcp({ CRIA_URL: cria.origin, CRIA_REPLY_TIMEOUT: '2 seconds', ...env })

    return { cria, mcp }
  })

const refusal = (code: string, message = 'refused by the fake') => ({ error: { code, message }, instanceId })
const posts = (cria: { readonly requests: ReadonlyArray<{ readonly method: string | undefined }> }) => cria.requests.filter(request => request.method === 'POST')
const accepts: FakeHandler = (_, response) => json(response, 202, rotating)
const settle = Effect.promise(() => new Promise(resolve => setTimeout(resolve, 800)))
const text = (message: unknown) => JSON.stringify(message)

describe('the fixtures', () => {
  it('are shapes the wire accepts', () => {
    expect(() => decodesAsWire(rotating)).not.toThrow()
    expect(() => [switchDevice(true), switchDevice(false)].forEach(decodesAsDevice)).not.toThrow()
  })
})

describe('a command tool against a fake Cria', () => {
  it.live('answers with the operation Cria accepted, after exactly one POST that carries what the agent sent and the tool name as kind', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(accepts)
      const result = yield* callTool(mcp.url, 'mount-rotate', rotateInput)

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ kind: 'answered', body: rotating })
      expect(cria.requests.map(request => `${request.method} ${request.url}`)).toEqual(['POST /v2/operations'])
      expect(JSON.parse(cria.requests[0]!.body)).toEqual({ ...mountId, kind: 'mount-rotate', parameters: rotation })
      expect(cria.requests[0]!.headers['content-type']).toContain('application/json')
      expect(cria.requests[0]!.headers.origin).toBeUndefined()
      expect(cria.requests[0]!.headers.authorization).toBeUndefined()
    }),
  )

  it.live('sends a bearer token when one is set', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(accepts, { CRIA_TOKEN: 'a-test-token' })

      yield* callTool(mcp.url, 'mount-rotate', rotateInput)
      expect(cria.requests[0]!.headers.authorization).toBe('Bearer a-test-token')
    }),
  )

  it.live('sends an empty parameters object for a kind that takes none, and still answers', () =>
    Effect.gen(function* () {
      const waiting = decodesAsWire({ id: operationId, ...mountId, failureDomain: 'mount', acceptedAt: 1_793_361_600_000, state: 'waiting', kind: 'mount-stop', parameters: {} })
      const { cria, mcp } = yield* against((_, response) => json(response, 202, waiting))
      const { parameters: _none, ...input } = rotateInput
      const result = yield* callTool(mcp.url, 'mount-stop', input)

      expect(result.structuredContent).toMatchObject({ kind: 'answered', body: { kind: 'mount-stop' } })
      expect(JSON.parse(cria.requests[0]!.body)).toEqual({ ...mountId, kind: 'mount-stop', parameters: {} })
    }),
  )

  it.live("passes every refusal code of the wire through unchanged, with Cria's status and body", () =>
    Effect.gen(function* () {
      let answer = refusal(errorCodes[0])
      let sent = 0
      const { cria, mcp } = yield* against((_, response) => json(response, 409, answer))

      for (const code of errorCodes) {
        answer = refusal(code)
        const result = yield* callTool(mcp.url, 'mount-rotate', rotateInput)

        expect(result.structuredContent, code).toEqual({ kind: 'refused', status: 409, body: refusal(code) })
        expect(posts(cria), code).toHaveLength(++sent)
      }
    }),
  )

  it.live('is lost on a timeout, and Cria sees exactly one POST even after the tool has answered', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(() => undefined, { CRIA_REPLY_TIMEOUT: '300 millis' })
      const result = yield* callTool(mcp.url, 'mount-rotate', rotateInput)

      expect(result.structuredContent).toMatchObject({ kind: 'lost', route: 'POST /v2/operations', why: 'timeout' })
      yield* settle
      expect(posts(cria)).toHaveLength(1)
    }),
  )

  it.live('is lost when the connection drops, and when the answer is not protocol 5, and never sends twice', () =>
    Effect.gen(function* () {
      const dropped = yield* against((request, _response) => void request.socket.destroy())
      const junk = yield* against((_, response) => json(response, 202, { id: operationId }))

      expect((yield* callTool(dropped.mcp.url, 'mount-rotate', rotateInput)).structuredContent).toMatchObject({ kind: 'lost', why: 'transport' })
      expect((yield* callTool(junk.mcp.url, 'mount-rotate', rotateInput)).structuredContent).toMatchObject({ kind: 'lost', why: 'not-protocol-5' })
      yield* settle
      expect(posts(dropped.cria)).toHaveLength(1)
      expect(posts(junk.cria)).toHaveLength(1)
    }),
  )

  it.live('is lost on a refusal that is not a protocol 5 error body', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against((_, response) => json(response, 500, { oops: true }))
      const result = yield* callTool(mcp.url, 'mount-rotate', rotateInput)

      expect(result.structuredContent).toMatchObject({ kind: 'lost', why: 'not-protocol-5' })
      expect(posts(cria)).toHaveLength(1)
    }),
  )

  it.live('does not follow a redirect, and says nothing of the address or the token', () =>
    Effect.gen(function* () {
      const elsewhere = yield* startFakeCria((_, response) => json(response, 202, rotating))
      const { cria, mcp } = yield* against(
        (_, response) => {
          response.writeHead(307, { location: `${elsewhere.origin}/v2/operations` })
          response.end()
        },
        { CRIA_TOKEN: 'a-secret-token' },
      )
      const result = yield* callTool(mcp.url, 'mount-rotate', rotateInput)

      expect(result.structuredContent).toMatchObject({ kind: 'lost', why: 'transport' })
      expect(elsewhere.requests).toEqual([])
      expect(posts(cria)).toHaveLength(1)
      expect(text(result)).not.toContain(cria.origin)
      expect(text(result)).not.toContain('a-secret-token')
    }),
  )

  it.live('says nothing of the address when Cria cannot be reached', () =>
    Effect.gen(function* () {
      const port = yield* freePort
      const mcp = yield* startMcp({ CRIA_URL: `http://127.0.0.1:${port}` })
      const result = yield* callTool(mcp.url, 'mount-rotate', rotateInput)

      expect(result.structuredContent).toMatchObject({ kind: 'lost', why: 'transport' })
      expect(text(result)).not.toContain(String(port))
    }),
  )
})

describe('a check of the wire, which JSON Schema cannot show', () => {
  const capture = (parameters: unknown) => ({ ...mountId, deviceId: 'camera', requestId: 'capture-1', parameters })

  it.live('refuses a flat frame with light false as an input error with the wire text, and Cria sees nothing', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(accepts)
      const message = yield* callToolRaw(mcp.url, 'capture', capture({ exposureSeconds: 1, light: false, frameType: 'flat' }))

      expect(message?.result?.structuredContent?.kind).toBeUndefined()
      expect(message?.error ?? message?.result?.isError).toBeTruthy()
      expect(text(message)).toContain('frameType flat needs light true')
      expect(cria.requests).toEqual([])
    }),
  )

  it.live('refuses an out-of-range value, a zero rate, a missing parameter and an empty configure as input errors', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(accepts)
      const bad: ReadonlyArray<readonly [string, unknown]> = [
        ['capture', capture({ exposureSeconds: 100_000, light: true })],
        ['mount-rotate', { ...rotateInput, parameters: { ...rotation, rateDegreesPerSecond: 0 } }],
        ['mount-rotate', { ...rotateInput, parameters: { rateDegreesPerSecond: 0.25 } }],
        ['mount-rotate', mountId],
        ['camera-configure', capture({})],
      ]

      for (const [tool, input] of bad) {
        const message = yield* callToolRaw(mcp.url, tool, input)

        expect(message?.error ?? message?.result?.isError, `${tool} ${text(input)}`).toBeTruthy()
      }
      expect(cria.requests).toEqual([])
    }),
  )

  it.live('refuses a missing identity field instead of filling it in', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(accepts)
      const { instanceId: _gone, ...withoutInstance } = rotateInput
      const message = yield* callToolRaw(mcp.url, 'mount-rotate', withoutInstance)

      expect(message?.error ?? message?.result?.isError).toBeTruthy()
      expect(cria.requests).toEqual([])
    }),
  )
})

describe('cancel and recover against a fake Cria', () => {
  const cancelPath = `/v2/operations/${operationId}/cancel`
  const recoverBody = { instanceId, bindingId: switchDevice(true).bindingId, externalRecoveryConfirmed: true, note: 'checked the switch by hand' }
  const recoverInput = { deviceId: 'power', ...recoverBody }

  it.live('cancel answers with the operation, after one POST with no body', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against((_, response) => json(response, 202, rotating))
      const result = yield* callTool(mcp.url, 'cancel', { operationId })

      expect(result.structuredContent).toEqual({ kind: 'answered', body: rotating })
      expect(cria.requests.map(request => `${request.method} ${request.url}`)).toEqual([`POST ${cancelPath}`])
      expect(cria.requests[0]!.body).toBe('')
    }),
  )

  it.live("cancel passes Cria's refusal through unchanged, and a timeout is lost with one POST", () =>
    Effect.gen(function* () {
      const refused = yield* against((_, response) => json(response, 404, notFound))
      const silent = yield* against(() => undefined, { CRIA_REPLY_TIMEOUT: '300 millis' })

      expect((yield* callTool(refused.mcp.url, 'cancel', { operationId })).structuredContent).toEqual({ kind: 'refused', status: 404, body: notFound })
      expect((yield* callTool(silent.mcp.url, 'cancel', { operationId })).structuredContent).toMatchObject({ kind: 'lost', route: `POST ${cancelPath}`, why: 'timeout' })
      yield* settle
      expect(posts(refused.cria)).toHaveLength(1)
      expect(posts(silent.cria)).toHaveLength(1)
    }),
  )

  it.live('recover answers with the device, after one POST of exactly what the agent gave', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against((_, response) => json(response, 200, switchDevice(false)))
      const result = yield* callTool(mcp.url, 'recover', recoverInput)

      expect(result.structuredContent).toEqual({ kind: 'answered', body: switchDevice(false) })
      expect(cria.requests.map(request => `${request.method} ${request.url}`)).toEqual(['POST /v2/devices/power/recover'])
      expect(JSON.parse(cria.requests[0]!.body)).toEqual(recoverBody)
    }),
  )

  it.live("recover passes Cria's refusal through unchanged, and a dropped connection is lost with one POST", () =>
    Effect.gen(function* () {
      const body = refusal('device-busy', 'An operation is still running')
      const refused = yield* against((_, response) => json(response, 409, body))
      const dropped = yield* against((request, _response) => void request.socket.destroy())

      expect((yield* callTool(refused.mcp.url, 'recover', recoverInput)).structuredContent).toEqual({ kind: 'refused', status: 409, body })
      expect((yield* callTool(dropped.mcp.url, 'recover', recoverInput)).structuredContent).toMatchObject({ kind: 'lost', why: 'transport' })
      yield* settle
      expect(posts(refused.cria)).toHaveLength(1)
      expect(posts(dropped.cria)).toHaveLength(1)
    }),
  )

  it.live('recover refuses a note that is empty, and a confirmation that is not true, as input errors', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against((_, response) => json(response, 200, switchDevice(false)))

      for (const input of [{ ...recoverInput, note: '' }, { ...recoverInput, externalRecoveryConfirmed: false }, { deviceId: 'power', instanceId }]) {
        const message = yield* callToolRaw(mcp.url, 'recover', input)

        expect(message?.error ?? message?.result?.isError, text(input)).toBeTruthy()
      }
      expect(cria.requests).toEqual([])
    }),
  )
})
