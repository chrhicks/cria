/**
 * Protocol 5 end to end, through the typed client built from @cria/wire, on a
 * fake camera: every response is decoded strictly against the contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeCriaClient } from '../../../testing/cria-client.js'
import { FakeIndi } from '@cria/fake-indi'
import { addCamera, exposeNormally } from './drivers.js'
import { allReady, startCria, type Cria } from './harness.js'

const camera = 'Fake CCD'
let fake: FakeIndi
let cria: Cria

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.define({ device: camera, name: 'CCD_TEMPERATURE', kind: 'number', perm: 'rw', state: 'Idle', elements: { CCD_TEMPERATURE_VALUE: { value: 20, min: -50, max: 50 } } })
  fake.behaviour = (fake, vector, values) => {
    if (vector.name !== 'CCD_TEMPERATURE') return exposeNormally()(fake, vector, values)
    fake.update(camera, vector.name, { state: 'Busy' })

    return 'handled'
  }
  cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600 })
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

describe('protocol 5', () => {
  it('serves health, state and events in the protocol 5 shapes', async () => {
    const client = makeCriaClient(cria.base)

    expect(await client.health()).toEqual({ status: 'ok', protocolVersion: 5 })
    const state = await client.state()

    expect(state.devices[0]).toMatchObject({ kind: 'camera', name: camera, quarantine: { held: false }, lastCommandedSetpointC: null })
    expect((await client.firstEvent()).instanceId).toBe(state.instanceId)
  })

  it('a capture settles with a confirmed outcome whose image downloads intact, and the device reports it read after it', async () => {
    const client = makeCriaClient(cria.base)
    const state = await cria.waitFor(allReady(['primary']))
    const device = state.devices[0]!
    const admitted = await client.submit({
      instanceId: state.instanceId,
      requestId: crypto.randomUUID(),
      deviceId: device.id,
      bindingId: device.bindingId,
      expectedName: device.name,
      kind: 'capture',
      parameters: { exposureSeconds: 0.1, light: true },
    })

    expect(admitted).toMatchObject({ status: 202, ok: true, body: { state: 'running', progress: { phase: 'preparing' } } })
    if (!admitted.ok) return

    const { operation } = await cria.settled(admitted.body.id)

    expect(operation.outcome).toMatchObject({ kind: 'confirmed', value: { image: { width: 8, height: 6 } } })
    expect((await client.download(operation)).status).toBe(200)

    const after = (await cria.waitFor(current => current.devices[0]!.afterOperation === operation.id, 4000)).devices[0]!

    expect(after.availability).toEqual({ ready: true })
  })

  it('reports a cooling setpoint as commanded, never as a reading', async () => {
    const client = makeCriaClient(cria.base)
    const state = await cria.waitFor(allReady(['primary']))
    const device = state.devices[0]!
    const admitted = await client.submit({
      instanceId: state.instanceId,
      requestId: crypto.randomUUID(),
      deviceId: device.id,
      bindingId: device.bindingId,
      expectedName: device.name,
      kind: 'cooling',
      parameters: { setpointC: -10 },
    })

    if (!admitted.ok) throw new Error(admitted.body.error.message)
    await cria.settled(admitted.body.id)

    const camera = (await client.state()).devices[0]!

    expect(camera.kind === 'camera' && camera.lastCommandedSetpointC).toMatchObject({ value: -10 })
    expect(camera.kind === 'camera' && camera.readings.setpointC).toEqual({ status: 'unavailable', reason: 'unsupported' })
  })

  it('answers 410 image-gone for an image the store has dropped to stay in its budget', async () => {
    const small = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600, imageBudgetBytes: 200 })

    try {
      await small.waitFor(allReady(['primary']))
      const first = await small.run('primary', 'capture', { exposureSeconds: 0.05, light: true })

      await small.waitFor(allReady(['primary']))
      const second = await small.run('primary', 'capture', { exposureSeconds: 0.05, light: true })
      const id = (url: string) => /\/v2\/images\/([^/]+)\/original/.exec(url)![1]!

      expect([first.image!.original.bytes, second.image!.original.bytes]).toEqual([140, 140])
      expect(await small.client.refusedOriginal(id(first.image!.original.url))).toMatchObject({
        status: 410,
        body: { error: { code: 'image-gone', message: 'This image is no longer kept' } },
      })
      expect((await small.client.download(second.operation)).status).toBe(200)
    } finally {
      await small.stop()
    }
  })
})
