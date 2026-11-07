import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCamera, FakeIndi } from '@cria/fake-indi'
import type { Entry, Publisher } from '@cria/stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenPublisher } from '../src/stream.js'
import { exposeNormally } from './drivers.js'
import { allReady, connectDevices, startCria, type Cria } from './harness.js'

const camera = 'Fake CCD'
const devices = [{ id: 'primary', kind: 'camera', indiDevice: camera }]

let fake: FakeIndi
let cria: Cria | undefined
let published: Array<{ readonly subject: string; readonly entry: Entry }>
let logins: Array<{ readonly user: string; readonly pass: string }> = []

const fakePublisher: OpenPublisher = (broker, onConnected) => {
  logins.push({ user: broker.user, pass: broker.pass })
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
  const folder = await mkdtemp(join(tmpdir(), 'cria-stream-'))
  const file = join(folder, 'client.json')

  await writeFile(join(folder, 'broker.pass'), 'p\n')
  await writeFile(file, contents.replaceAll('PASS_FILE', join(folder, 'broker.pass')))

  return file
}

const broker = JSON.stringify({ broker: { servers: 'nats://nowhere', user: 'u', passFile: 'PASS_FILE' } })

const body = (kind: string) => published.filter(({ entry }) => entry.kind === kind).map(({ entry }) => entry.body as Record<string, unknown>)

beforeEach(async () => {
  published = []
  logins = []
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
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))

    expect(published[0]?.subject).toBe('rig-dev.client')
    expect(published[0]?.entry.kind).toBe('client.connected')
    expect(published[0]?.entry.source).toMatch(/:cria$/)
    expect(published[0]?.entry.body).toMatchObject({ client: 'cria', connection: 1, sources: ['cria'] })
  })

  it('publishes a request and how it ended, with only the fields worth keeping', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))

    const ending = await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })
    const request = body('cria.request').find(entry => entry['kind'] === 'capture')
    const settled = body('cria.settled').find(entry => entry['kind'] === 'capture')

    expect(request).toMatchObject({ deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 0.01, light: true }, result: 'accepted', operationId: ending.id })
    expect(settled).toMatchObject({ id: ending.id, deviceId: 'primary', outcome: { kind: 'confirmed' } })
  })

  it('publishes each write it sends, naming the device and property, and nothing it only reads', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))
    await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })

    const writes = body('cria.write')
    const exposure = writes.find(write => write['property'] === 'CCD_EXPOSURE')

    expect(exposure).toMatchObject({ device: 'other', conn: 1 })
    expect(exposure?.['xml']).toContain('CCD_EXPOSURE_VALUE')
    expect(writes.every(write => String(write['xml']).startsWith('<new'))).toBe(true)
    expect(published.find(({ entry }) => entry.kind === 'cria.write')?.subject).toBe('rig-dev.cria.write')
  })

  it('names the device from the settings file when it has one', async () => {
    const named = JSON.stringify({ wireDevices: { [camera]: 'primary' }, broker: { servers: 'nats://nowhere', user: 'u', passFile: 'PASS_FILE' } })

    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(named) }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))
    await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })

    expect(body('cria.write').find(write => write['property'] === 'CCD_EXPOSURE')).toMatchObject({ device: 'primary' })
  })

  it('publishes each frame it keeps with the camera\'s whole header and its checksum', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))

    const ending = await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })
    const [frame] = body('cria.frame')

    expect(frame).toMatchObject({
      operationId: ending.id,
      deviceId: 'primary',
      imageId: ending.image!.id,
      sha256: ending.image!.sha256,
      bytes: ending.image!.original.bytes,
      exposureSeconds: 0.01,
    })
    expect(frame!['header']).toEqual(expect.arrayContaining([expect.stringMatching(/^SIMPLE/), expect.stringMatching(/^BITPIX/)]))
  })

  it('publishes no frame for a capture that fails', async () => {
    fake.behaviour = (_fake, vector) => (vector.name === 'CCD_EXPOSURE' ? 'handled' : 'default')
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker), acknowledgeMs: 500 }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))
    await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })

    expect(body('cria.frame')).toEqual([])
  })

  it('publishes a refusal with its reason', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    const state = await cria.waitFor(allReady(['primary']))
    const response = await fetch(`${cria.base}/v2/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: crypto.randomUUID(), requestId: crypto.randomUUID(), deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 0.01, light: true } }),
    })

    expect(response.ok).toBe(false)
    expect(body('cria.request').at(-1)).toMatchObject({ deviceId: 'primary', result: 'refused', code: 'instance-changed' })
  })

  it('logs in with the password from its own file', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })

    expect(logins).toEqual([{ user: 'u', pass: 'p' }])
  })

  it('runs without publishing when the password file cannot be read', async () => {
    const missing = JSON.stringify({ broker: { servers: 'nats://nowhere', user: 'u', passFile: '/nonexistent/broker.pass' } })

    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(missing) }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))

    expect([logins, published]).toEqual([[], []])
  })

  it('runs without publishing, and without showing the file, when its settings cannot be read', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings('{"broker":{"pass":"secret"') }, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))

    expect(published).toEqual([])
    expect((await cria.run('primary', 'capture', { exposureSeconds: 0.01, light: true })).kind).toBe('confirmed')
  })

  it('does not publish when no stream is configured', async () => {
    cria = await startCria(fake.port, devices, {}, { stream: fakePublisher })
    await connectDevices(cria, ['primary'])
    await cria.waitFor(allReady(['primary']))

    expect(published).toEqual([])
  })
})
