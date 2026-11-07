import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera } from '@cria/fake-indi'
import { exposeNormally } from './drivers.js'
import { startCria, type Cria } from './harness.js'

const camera = 'Fake CCD'
let fake: FakeIndi
let cria: Cria
let instanceId: string

beforeAll(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.behaviour = exposeNormally()
  cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }])
  instanceId = cria.service.rig.instanceId
})

afterAll(async () => {
  await cria.stop()
  await fake.stop()
})

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(cria.base + path, init)

  return { status: response.status, body: (await response.json()) as unknown }
}

const refusal = (code: string, message: string) => ({ error: { code, message }, instanceId })

describe('health', () => {
  it('serves state and /health', async () => {
    const state = await call('/v2/state')

    expect([state.status, (state.body as { instanceId: string }).instanceId]).toEqual([200, instanceId])
    expect(await call('/health')).toEqual({ status: 200, body: { status: 'ok', protocolVersion: 5, instanceId, commandsEnabled: true } })
  })
})

describe('refusals before any route', () => {
  it('refuses a browser origin', async () => {
    expect(await call('/v2/state', { headers: { origin: 'http://example.test' } })).toEqual({
      status: 403,
      body: refusal('origin-rejected', 'Browser origins are not accepted'),
    })
  })

  it('answers 404 not-found for a route that does not exist', async () => {
    expect(await call('/v2/nothing')).toEqual({ status: 404, body: refusal('not-found', 'No such route') })
    expect(await call('/v1/state')).toEqual({ status: 404, body: refusal('not-found', 'No such route') })
    expect(await call('/v2/state', { method: 'DELETE' })).toEqual({ status: 404, body: refusal('not-found', 'No such route') })
  })
})

describe('request bodies', () => {
  it('refuses a body that is not JSON', async () => {
    expect(await call('/v2/operations', { method: 'POST', body: '{"kind": capture' })).toEqual({
      status: 400,
      body: refusal('request-error', 'Body is not JSON'),
    })
  })

  it('refuses a body over 16 KiB, and takes one just under', async () => {
    const padded = (bytes: number) => JSON.stringify({ note: 'x'.repeat(bytes - '{"note":""}'.length) })

    expect(Buffer.byteLength(padded(16 * 1024))).toBe(16 * 1024)
    expect(await call('/v2/operations', { method: 'POST', body: padded(16 * 1024 + 1) })).toEqual({
      status: 413,
      body: refusal('request-too-large', 'Request body too large'),
    })
    expect(await call('/v2/operations', { method: 'POST', body: padded(16 * 1024) })).toMatchObject({
      status: 400,
      body: { error: { code: 'request-error' } },
    })
  })
})

describe('GET /v2/events over HTTP', () => {
  async function firstEvent(response: Response) {
    const reader = response.body!.getReader()
    let text = ''

    while (true) {
      const { value, done } = await reader.read()

      if (done) throw new Error('event stream ended before its first event')
      text += new TextDecoder().decode(value)
      const event = /event: state\ndata: (.*)\n\n/.exec(text)

      if (event) return JSON.parse(event[1]!) as { sequence: number; operations: unknown[] }
    }
  }

  it('opens with a fresh snapshot, and refuses the 17th subscriber with 429', async () => {
    const before = (await call('/v2/state')).body as { sequence: number; operations: unknown[] }
    const controller = new AbortController()
    const stream = () => fetch(`${cria.base}/v2/events`, { signal: controller.signal })

    try {
      const first = await firstEvent(await stream())

      expect([first.sequence, first.operations]).toEqual([before.sequence + 1, before.operations])

      const fifteen = await Promise.all(Array.from({ length: 15 }, () => stream()))

      expect(fifteen.map(response => response.status)).toEqual(Array(15).fill(200))
      expect(await call('/v2/events')).toEqual({ status: 429, body: refusal('too-many-subscribers', 'Too many event subscribers') })
    } finally {
      controller.abort()
    }
  })
})
