import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCamera, FakeIndi } from '@cria/fake-indi'
import type { Entry, Publisher } from '@cria/stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenPublisher } from '../src/stream.js'
import { propertyOf, startCria, until, type Cria } from './harness.js'

const camera = 'Fake CCD'
const devices = [{ id: 'primary', kind: 'camera', indiDevice: camera }] as const

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
    listen: () => {},
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

const connect = async () => {
  await until('Cria to see the camera', () => propertyOf(cria!, camera, 'CONNECTION'))

  return cria!.connect('primary')
}

const body = (kind: string) => published.filter(({ entry }) => entry.kind === kind).map(({ entry }) => entry.body as Record<string, unknown>)

beforeEach(async () => {
  published = []
  logins = []
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera, { width: 8, height: 6, upload: 'local' })
  fake.update(camera, 'CONNECTION', { values: { CONNECT: false, DISCONNECT: true } })
})

afterEach(async () => {
  await cria?.stop()
  cria = undefined
  await fake.stop()
})

describe('Cria on the rig stream', () => {
  it('says who it is before anything else', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connect()

    expect(published[0]?.subject).toBe('rig-dev.client')
    expect(published[0]?.entry.kind).toBe('client.connected')
    expect(published[0]?.entry.source).toMatch(/:cria$/)
    expect(published[0]?.entry.body).toEqual({ client: 'cria', run: cria.service.rig.instanceId, connection: 1, sources: ['cria'] })
  })

  it('publishes one request and one settled entry for a device-connect', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connect()

    expect(body('cria.request')).toEqual([{ deviceId: 'primary', kind: 'device-connect', connected: true, result: 'accepted' }])
    expect(body('cria.settled')).toEqual([{ deviceId: 'primary', kind: 'device-connect', connected: true, outcome: { kind: 'confirmed', setup: 'sent UPLOAD_MODE UPLOAD_CLIENT=On' } }])
    expect(published.find(({ entry }) => entry.kind === 'cria.request')?.subject).toBe('rig-dev.cria.request')
    expect(published.find(({ entry }) => entry.kind === 'cria.settled')?.subject).toBe('rig-dev.cria.settled')
  })

  it('publishes nothing for a request it refuses', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await cria.post('/connect', { deviceId: 'nothing', connected: true })

    expect([body('cria.request'), body('cria.settled')]).toEqual([[], []])
  })

  it('publishes each write it sends, naming the device and property, and nothing it only reads', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })
    await connect()

    const writes = body('cria.write')

    expect(writes.map(write => write['property'])).toEqual(['CONNECTION', 'UPLOAD_MODE'])
    expect(writes[0]).toMatchObject({ device: 'other', conn: 1 })
    expect(writes.every(write => String(write['xml']).startsWith('<new'))).toBe(true)
    expect(published.find(({ entry }) => entry.kind === 'cria.write')?.subject).toBe('rig-dev.cria.write')
  })

  it('names the device from the settings file when it has one', async () => {
    const named = JSON.stringify({ wireDevices: { [camera]: 'primary' }, broker: { servers: 'nats://nowhere', user: 'u', passFile: 'PASS_FILE' } })

    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(named) }, { stream: fakePublisher })
    await connect()

    expect(body('cria.write')[0]).toMatchObject({ device: 'primary' })
  })

  it('logs in with the password from its own file', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(broker) }, { stream: fakePublisher })

    expect(logins).toEqual([{ user: 'u', pass: 'p' }])
  })

  it('runs without publishing when the password file cannot be read', async () => {
    const missing = JSON.stringify({ broker: { servers: 'nats://nowhere', user: 'u', passFile: '/nonexistent/broker.pass' } })

    cria = await startCria(fake.port, devices, { streamClientConfig: await settings(missing) }, { stream: fakePublisher })
    await connect()

    expect([logins, published]).toEqual([[], []])
  })

  it('runs without publishing, and without showing the file, when its settings cannot be read', async () => {
    cria = await startCria(fake.port, devices, { streamClientConfig: await settings('{"broker":{"pass":"secret"') }, { stream: fakePublisher })

    expect((await connect()).outcome).toBe('confirmed')
    expect(published).toEqual([])
  })

  it('does not publish when no stream is configured', async () => {
    cria = await startCria(fake.port, devices, {}, { stream: fakePublisher })
    await connect()

    expect(published).toEqual([])
  })
})
