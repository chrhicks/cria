/**
 * Protocol 5 end to end, through the typed client built from @cria/wire, on a
 * fake camera: every response is decoded strictly against the contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeCriaClient } from '../../../testing/cria-client.js'
import { FakeIndi, addCamera } from '@cria/fake-indi'
import { exposeNormally } from './drivers.js'
import { connectDevices, startCria, type Cria } from './harness.js'

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
  it('serves health in the protocol 5 shape', async () => {
    const client = makeCriaClient(cria.base)

    expect(await client.health()).toEqual({ status: 'ok', protocolVersion: 5, instanceId: cria.service.rig.instanceId, commandsEnabled: true })
  })

  it('a capture settles with a confirmed outcome whose image downloads intact', async () => {
    const client = makeCriaClient(cria.base)
    await connectDevices(cria, ['primary'])
    const admitted = await client.submit({
      instanceId: cria.service.rig.instanceId,
      requestId: crypto.randomUUID(),
      deviceId: 'primary',
      kind: 'capture',
      parameters: { exposureSeconds: 0.1, light: true },
    })

    expect(admitted).toMatchObject({ status: 202, ok: true, body: { state: 'running', progress: { phase: 'preparing' } } })
    if (!admitted.ok) return

    const { operation } = await cria.settled(admitted.body.id)

    expect(operation.outcome).toMatchObject({ kind: 'confirmed', value: { image: { width: 8, height: 6 } } })
    expect((await client.download(operation)).status).toBe(200)
  })

  it('confirms a cooling setpoint once the driver starts regulating', async () => {
    const client = makeCriaClient(cria.base)
    await connectDevices(cria, ['primary'])
    const admitted = await client.submit({
      instanceId: cria.service.rig.instanceId,
      requestId: crypto.randomUUID(),
      deviceId: 'primary',
      kind: 'cooling',
      parameters: { setpointC: -10 },
    })

    if (!admitted.ok) throw new Error(admitted.body.error.message)

    expect((await cria.settled(admitted.body.id)).operation.outcome).toMatchObject({ kind: 'confirmed', value: { values: { setpointC: -10 } } })
  })

  it('answers 410 image-gone for an image the store has dropped to stay in its budget', async () => {
    const small = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600, imageBudgetBytes: 8000 })

    try {
      await connectDevices(small, ['primary'])
      const first = await small.run('primary', 'capture', { exposureSeconds: 0.05, light: true })

      const second = await small.run('primary', 'capture', { exposureSeconds: 0.05, light: true })
      const id = (url: string) => /\/v2\/images\/([^/]+)\/original/.exec(url)![1]!

      expect([first.image!.original.bytes, second.image!.original.bytes]).toEqual([5760, 5760])
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
