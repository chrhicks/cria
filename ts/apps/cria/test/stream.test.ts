import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCamera, FakeIndi } from '@cria/fake-indi'
import type { Entry, Publisher } from '@cria/stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenPublisher } from '../src/stream.js'
import { exposeNormally } from './drivers.js'
import { allReady, startCria, type Cria } from './harness.js'

const camera = 'Fake CCD'
const devices = [{ id: 'primary', kind: 'camera', indiDevice: camera }]

let fake: FakeIndi
let cria: Cria | undefined
let published: Array<{ readonly subject: string; readonly entry: Entry }>

const fakePublisher: OpenPublisher = (_broker, onConnected) => {
  const publisher: Publisher = {
    ready: Promise.resolve(),
    publish: (subject, entry) => published.push({ subject, entry }),
    publishConfirmed: (subject, entry) => {
      published.push({ subject, entry })

      return Promise.resolve()
    },
    close: () => Promise.resolve(),
  }

  queueMicrotask(() => onConnected(1))

  return publisher
}

async function settings(contents: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'cria-stream-')), 'client.json')

  await writeFile(file, contents)

  return file
}

const broker = JSON.stringify({ broker: { servers: 'nats://nowhere', user: 'u', pass: 'p' } })

const body = (kind: string) => published.filter(({ entry }) => entry.kind === kind).map(({ entry }) => entry.body as Record<string, unknown>)

beforeEach(async () => {
  published = []
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.behaviour = exposeNormally()
})

afterEach(async () => {
  await cria?.stop()
  cria = undefined
  await fake.stop()
})

describe('Cria on the rig stream', () => {
  it('says who it is before anything else', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await cria.waitFor(allReady(['primary']))

    expect(published[0]?.subject).toBe('rig-dev.client')
    expect(published[0]?.entry.kind).toBe('client.connected')
    expect(published[0]?.entry.source).toMatch(/:cria$/)
    expect(published[0]?.entry.body).toMatchObject({ client: 'cria', connection: 1, sources: ['cria'] })
  })

  it('publishes a request and how it ended, with only the fields worth keeping', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await cria.waitFor(allReady(['primary']))

    const ending = await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })
    const request = body('cria.request').find(entry => entry['kind'] === 'capture')
    const settled = body('cria.settled').find(entry => entry['kind'] === 'capture')

    expect(request).toMatchObject({ deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 0.01, light: true }, result: 'accepted', operationId: ending.id })
    expect(request).not.toHaveProperty('bindingId')
    expect(request).not.toHaveProperty('expectedName')
    expect(settled).toMatchObject({ id: ending.id, deviceId: 'primary', outcome: { kind: 'confirmed' } })
    expect(settled).not.toHaveProperty('bindingId')
  })

  it('publishes a refusal with its reason', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    const state = await cria.waitFor(allReady(['primary']))
    const device = state.devices[0]!
    const response = await fetch(`${cria.base}/v2/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: state.instanceId, requestId: crypto.randomUUID(), deviceId: 'primary', bindingId: crypto.randomUUID(), expectedName: device.name, kind: 'capture', parameters: { exposureSeconds: 0.01, light: true } }),
    })

    expect(response.ok).toBe(false)
    expect(body('cria.request').at(-1)).toMatchObject({ deviceId: 'primary', result: 'refused', code: 'binding-changed' })
  })

  it('runs without publishing, and without showing the file, when its settings cannot be read', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings('{"broker":{"pass":"secret"') }, { stream: fakePublisher })
    await cria.waitFor(allReady(['primary']))

    expect(published).toEqual([])
    expect((await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })).kind).toBe('confirmed')
  })

  it('does not publish when no stream is configured', async () => {
    cria = await startCria(fake.port, devices, {}, { stream: fakePublisher })
    await cria.waitFor(allReady(['primary']))

    expect(published).toEqual([])
  })
})
