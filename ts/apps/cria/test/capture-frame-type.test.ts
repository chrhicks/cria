/** The camera's INDI frame type follows the capture request, and requests without a frame type still work. */
import { Effect, Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera } from '@cria/fake-indi'
import { exposeNormally } from './drivers.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const camera = 'Fake CCD'
let fake: FakeIndi
let cria: Cria

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.behaviour = exposeNormally()
  cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['primary']))
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

const selected = () =>
  Object.entries(fake.vector(camera, 'CCD_FRAME_TYPE').elements)
    .filter(([, { value }]) => value === true)
    .map(([name]) => name)
const frameTypeWrites = () => fake.received.filter(xml => xml.startsWith('<new') && xml.includes('name="CCD_FRAME_TYPE"')).length
const mirrored = (seen: (elements: ReadonlyArray<string> | undefined) => boolean) =>
  until('Cria to see the frame type change', () => {
    const property = Option.getOrUndefined(Effect.runSync(cria.service.rig.client.device(camera).property('CCD_FRAME_TYPE')))

    return seen(property && [...property.elements.keys()])
  })
const exposures = () => fake.received.filter(xml => xml.includes('name="CCD_EXPOSURE"')).length

describe('capture frame type', () => {
  it.each([
    [{ light: true, frameType: 'light' }, 'FRAME_LIGHT'],
    [{ light: true, frameType: 'flat' }, 'FRAME_FLAT'],
    [{ light: false, frameType: 'dark' }, 'FRAME_DARK'],
    [{ light: false, frameType: 'bias' }, 'FRAME_BIAS'],
  ])('%o selects %s before the exposure', async (parameters, element) => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.05, ...parameters })

    expect(operation.kind).toBe('confirmed')
    expect(selected()).toEqual([element])
  })

  it('sets the frame type before it sends the exposure', async () => {
    await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true, frameType: 'flat' })

    const sentOrder = fake.received.filter(xml => xml.startsWith('<new')).map(xml => /name="(CCD_FRAME_TYPE|CCD_EXPOSURE)"/.exec(xml)?.[1])

    expect(sentOrder.filter(Boolean)).toEqual(['CCD_FRAME_TYPE', 'CCD_EXPOSURE'])
  })

  it('returns to light after a flat, without writing when the type already matches', async () => {
    await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true, frameType: 'flat' })
    await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true, frameType: 'flat' })
    expect(frameTypeWrites()).toBe(1)

    await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })
    expect([selected(), frameTypeWrites()]).toEqual([['FRAME_LIGHT'], 2])
  })

  it('treats a request with no frame type as light when `light` is true and dark when it is false, as before', async () => {
    await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })
    expect([selected(), frameTypeWrites()]).toEqual([['FRAME_LIGHT'], 0])

    await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: false })
    expect(selected()).toEqual(['FRAME_DARK'])
  })

  it.each([
    [{ light: true, frameType: 'bias' }, 'frameType bias needs light false'],
    [{ light: false, frameType: 'flat' }, 'frameType flat needs light true'],
  ])('refuses %o before any exposure', async (parameters, message) => {
    const refused = await cria.submit('primary', 'capture', { exposureSeconds: 0.05, ...parameters })

    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'request-error' } } })
    expect(JSON.stringify(refused.body)).toContain(message)
    expect([exposures(), frameTypeWrites()]).toEqual([0, 0])
  })

  it('still refuses a key it does not know', async () => {
    const refused = await cria.submit('primary', 'capture', { exposureSeconds: 0.05, light: true, frametype: 'flat' })

    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'request-error' } } })
  })

  it('refuses a calibration frame the camera cannot select, before any exposure', async () => {
    fake.removeVector(camera, 'CCD_FRAME_TYPE')
    await mirrored(elements => elements === undefined)

    const flat = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true, frameType: 'flat' })
    const light = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })

    expect([flat.kind, flat.reason, flat.message]).toEqual(['failed', 'unsupported', 'Camera has no frame type'])
    expect(light.kind).toBe('confirmed')
    expect(exposures()).toBe(1)
  })

  it('refuses a type the camera lacks as an element', async () => {
    fake.define({ device: camera, name: 'CCD_FRAME_TYPE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { FRAME_LIGHT: { value: true }, FRAME_DARK: { value: false } } })
    await mirrored(elements => elements?.includes('FRAME_BIAS') === false)

    const bias = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: false, frameType: 'bias' })

    expect([bias.kind, bias.reason, bias.message]).toEqual(['failed', 'unsupported', 'Camera has no bias frame type'])
    expect(exposures()).toBe(0)
  })
})
