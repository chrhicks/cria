import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera } from '../../testing/fake-indi/index.ts'
import { propertyOf, startCria, until, type Cria } from '../../testing/harness.ts'

const camera = 'Fake CCD'
let fake: FakeIndi
let cria: Cria

beforeAll(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.update(camera, 'CONNECTION', { values: { CONNECT: false, DISCONNECT: true } })
  cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }])
  await until('Cria to see the camera', () => propertyOf(cria, camera, 'CONNECTION'))
})

afterAll(async () => {
  await cria.stop()
  await fake.stop()
})

describe('health', () => {
  it('names the protocol and the instance, and nothing else', async () => {
    expect(await cria.get('/health')).toEqual({ status: 200, body: { status: 'ok', protocolVersion: 6, instanceId: cria.service.rig.instanceId } })
  })
})

describe('routes', () => {
  it('answers 404 for anything but health and connect', async () => {
    expect((await cria.get('/v2/operations')).status).toBe(404)
    expect((await cria.get('/connect')).status).toBe(404)
    expect((await cria.post('/health', {})).status).toBe(404)
  })
})

describe('connect', () => {
  it('answers 400 for a body that is not a connect request', async () => {
    for (const body of ['{"deviceId": primary', '{}', { deviceId: 'primary' }, { deviceId: 'primary', connected: 'yes' }, { deviceId: 'primary', connected: true, requestId: 'r' }, { deviceId: 'a b', connected: true }])
      expect((await cria.post('/connect', body)).status).toBe(400)
  })

  it('answers 404 for a device that is not configured', async () => {
    expect((await cria.post('/connect', { deviceId: 'nothing', connected: true })).status).toBe(404)
  })

  it('answers when the device is connected', async () => {
    expect(await cria.post('/connect', { deviceId: 'primary', connected: true })).toEqual({ status: 200, body: { outcome: 'confirmed', setup: 'UPLOAD_MODE already set' } })
  })
})
