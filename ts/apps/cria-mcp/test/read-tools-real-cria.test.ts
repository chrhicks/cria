import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { FakeIndi, addCamera, addMount, type Behaviour } from '@cria/fake-indi'
import { fitsFrame } from '@cria/fits'
import { Image, Operation, type OperationRequest } from '@cria/wire'
import { makeCriaClient } from '../../../testing/cria-client.js'
import { callTool, startMcp, startRealCria } from './support.js'

const strict = { onExcessProperty: 'error' } as const

/** A camera that finishes an exposure after its duration and sends a frame. */
const exposesAndSendsFrame: Behaviour = (fake, vector, values) => {
  if (vector.name !== 'CCD_EXPOSURE') return 'default'
  const seconds = Number(values.CCD_EXPOSURE_VALUE)
  const startedAt = Date.now()

  fake.update(vector.device, vector.name, { state: 'Busy', values: { CCD_EXPOSURE_VALUE: seconds } })
  setTimeout(() => {
    if (fake.vector(vector.device, 'CCD_EXPOSURE').state !== 'Busy') return
    fake.sendBlob(vector.device, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: seconds, startedAt }))
    fake.update(vector.device, 'CCD_EXPOSURE', { state: 'Ok', values: { CCD_EXPOSURE_VALUE: 0 } })
  }, seconds * 1000).unref()

  return 'handled'
}

/**
 * A real Cria process on a fake INDI camera, with commands enabled: they reach only the fake.
 * The test sends them through Cria's own HTTP API, because command tools are not part of this server yet.
 */
const rig = Effect.gen(function* () {
  const fake = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const indi = new FakeIndi()

      await indi.start()
      addCamera(indi, 'Fake CCD')
      addMount(indi, 'Fake Mount')
      indi.behaviour = exposesAndSendsFrame

      return indi
    }),
    indi => Effect.promise(() => indi.stop()),
  )
  const cria = yield* startRealCria(fake.port, { commandsEnabled: true })
  const client = makeCriaClient(cria.origin)
  const ready = yield* Effect.promise(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await client.state()

      if (state.devices.length === 2 && state.devices.every(device => device.availability.ready)) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Cria never showed both devices ready')
  })
  const camera = ready.devices.find(device => device.id === 'camera')!
  const capture = (requestId: string, exposureSeconds: number) =>
    Effect.promise(async () => {
      const reply = await client.submit({
        instanceId: ready.instanceId,
        requestId,
        deviceId: camera.id,
        bindingId: camera.bindingId,
        expectedName: camera.name,
        kind: 'capture',
        parameters: { exposureSeconds, light: true },
      } as unknown as OperationRequest)

      if (!reply.ok) throw new Error(`Cria refused the capture: ${JSON.stringify(reply.body)}`)

      return reply.body
    })
  const mcp = yield* startMcp({ CRIA_URL: cria.origin })

  return { origin: cria.origin, client, capture, mcp }
})

describe('the read tools against a real Cria on a fake INDI camera', () => {
  it.live('wait settles a capture Cria ran, image downloads its frame, and request finds it by requestId', () =>
    Effect.gen(function* () {
      const { origin, capture, mcp } = yield* rig
      const accepted = yield* capture('capture-by-cria-api', 0.3)
      const waited = yield* callTool(mcp.url, 'wait', { operationId: accepted.id, maxSeconds: 20 })

      expect(waited.structuredContent.kind).toBe('answered')

      const settled = Schema.decodeUnknownSync(Operation)(waited.structuredContent.body, strict)

      if (settled.state !== 'settled' || settled.outcome.kind !== 'confirmed' || settled.outcome.value.image === null)
        throw new Error(`The capture did not confirm: ${JSON.stringify(waited.structuredContent)}`)
      const image = settled.outcome.value.image
      const downloaded = yield* callTool(mcp.url, 'image', { image })

      expect(downloaded.structuredContent.kind).toBe('answered')

      const { path, sha256, bytes, image: returned } = downloaded.structuredContent.body
      const direct = yield* Effect.promise(() => fetch(origin + image.original.url))
      const directBytes = Buffer.from(yield* Effect.promise(() => direct.arrayBuffer()))
      const onDisk = yield* Effect.promise(() => readFile(path))

      expect(Schema.decodeUnknownSync(Image)(returned, strict)).toEqual(image)
      expect(sha256).toBe(direct.headers.get('etag')!.replaceAll('"', ''))
      expect(createHash('sha256').update(onDisk).digest('hex')).toBe(sha256)
      expect(bytes).toBe(Number(direct.headers.get('content-length')))
      expect(Buffer.compare(onDisk, directBytes)).toBe(0)
      expect(path).toBe(`${mcp.imageDirectory}/${image.id}.imagebytes`)
      expect(yield* Effect.promise(() => readdir(mcp.imageDirectory))).toEqual([`${image.id}.imagebytes`])

      const found = yield* callTool(mcp.url, 'request', { instanceId: accepted.instanceId, requestId: 'capture-by-cria-api' })

      expect(found.structuredContent).toEqual({ kind: 'answered', body: JSON.parse(JSON.stringify(settled)) })
      expect(found.structuredContent.body.id).toBe(accepted.id)

      const read = yield* callTool(mcp.url, 'operation', { operationId: accepted.id })

      expect(read.structuredContent).toEqual(found.structuredContent)
    }),
  )

  it.live("wait returns a capture that is still exposing, and request passes Cria's not-found through for a request it never saw", () =>
    Effect.gen(function* () {
      const { client, capture, mcp } = yield* rig
      const accepted = yield* capture('long-capture', 5)
      const waited = yield* callTool(mcp.url, 'wait', { operationId: accepted.id, maxSeconds: 2 })

      expect(waited.structuredContent).toMatchObject({ kind: 'answered', body: { id: accepted.id, state: 'running', progress: { phase: 'exposing' } } })

      const unknown = yield* callTool(mcp.url, 'request', { instanceId: accepted.instanceId, requestId: 'never-sent' })

      expect(unknown.structuredContent).toMatchObject({ kind: 'refused', status: 404, body: { error: { code: 'not-found' } } })
      expect((yield* Effect.promise(() => client.cancel(accepted.id))).ok).toBe(true)
    }),
  )
})
