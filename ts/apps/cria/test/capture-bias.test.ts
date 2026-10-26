/** A bias frame has no exposure time: Cria commands the camera's minimum and expects a frame at that time. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera } from '@cria/fake-indi'
import { fitsFrame } from '@cria/fits'
import { biasAtMinimum, exposeNormally } from './drivers.js'
import { allReady, startCria, type Cria } from './harness.js'

const camera = 'Fake CCD'
const minimum = 3.2e-5
let fake: FakeIndi
let cria: Cria
let exposed: number[]

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera)
  fake.define({ device: camera, name: 'CCD_EXPOSURE', kind: 'number', perm: 'rw', state: 'Ok', elements: { CCD_EXPOSURE_VALUE: { value: 1, min: minimum, max: 3600, step: 1 } } })
  exposed = []
  fake.behaviour = biasAtMinimum(minimum, exposed)
  cria = await start()
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

const start = async (overrides: object = {}) => {
  const started = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }], { acknowledgeMs: 600, readoutAllowanceMs: 1000, ...overrides })

  await started.waitFor(allReady(['primary']))

  return started
}

const commanded = () =>
  fake.received
    .filter(xml => xml.startsWith('<new') && xml.includes('name="CCD_EXPOSURE"'))
    .map(xml => Number(/<oneNumber name="CCD_EXPOSURE_VALUE">([^<]*)</.exec(xml)?.[1]))
const exposureWrites = () => commanded().length

describe('a bias capture', () => {
  it('commands the camera minimum, not the requested time, and takes the frame the driver exposes at the minimum', async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.1, light: false, frameType: 'bias' })

    expect(operation.kind).toBe('confirmed')
    expect(commanded()).toEqual([minimum])
    expect(exposed).toEqual([minimum])
  })

  it('succeeds when the request is already the minimum', async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: minimum, light: false, frameType: 'bias' })

    expect([operation.kind, commanded()]).toEqual(['confirmed', [minimum]])
  })

  it('still refuses a request outside the camera range, before any exposure', async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.000001, light: false, frameType: 'bias' })

    expect([operation.kind, operation.reason]).toEqual(['failed', 'invalid'])
    expect(operation.message).toMatch(/outside/)
    expect(exposureWrites()).toBe(0)
  })

  it('fails without a hold when the frame is not at the minimum and the camera is idle', async () => {
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'CCD_EXPOSURE') return exposeNormally()(fake, vector, values)
      fake.update(camera, vector.name, { state: 'Busy' })
      setTimeout(() => {
        fake.sendBlob(camera, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: 0.1 }))
        fake.update(camera, 'CCD_EXPOSURE', { state: 'Ok', values: { CCD_EXPOSURE_VALUE: 0 } })
      }, 100)

      return 'handled'
    }

    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.1, light: false, frameType: 'bias' })

    expect(operation).toMatchObject({ kind: 'failed', reason: 'rejected', quarantined: false })
    expect(operation.message).toMatch(/not this exposure.*EXPTIME 1\.000000E-1.*idle/)
    expect(operation.image).toBeNull()
  })

  it('waits for the minimum plus the readout allowance, not for the requested time', async () => {
    fake.behaviour = (fake, vector, values) => {
      if (vector.name !== 'CCD_EXPOSURE') return exposeNormally()(fake, vector, values)
      fake.update(camera, vector.name, { state: 'Busy' })

      return 'handled'
    }

    const startedAt = Date.now()
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 600, light: false, frameType: 'bias' })

    expect([operation.kind, operation.reason]).toEqual(['failed', 'unavailable'])
    expect(operation.message).toBe('No frame arrived within the 0.000032 s exposure and the 1 s readout allowance')
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  }, 20_000)
})

describe('the other frame types', () => {
  it.each([
    [{ light: true }, 'light'],
    [{ light: true, frameType: 'flat' }, 'flat'],
    [{ light: false, frameType: 'dark' }, 'dark'],
    [{ light: false }, 'dark'],
  ])('%o commands and expects the requested time (%s)', async parameters => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.05, ...parameters })

    expect(operation.kind).toBe('confirmed')
    expect(commanded()).toEqual([0.05])
    expect(exposed).toEqual([0.05])
  })

  it('rejects a dark the driver exposed at the minimum', async () => {
    fake.behaviour = (fake, vector, values) =>
      vector.name === 'CCD_EXPOSURE' ? exposeNormally()(fake, vector, { ...values, CCD_EXPOSURE_VALUE: minimum }) : exposeNormally()(fake, vector, values)

    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: false, frameType: 'dark' })

    expect(operation).toMatchObject({ kind: 'failed', reason: 'rejected', quarantined: false })
    expect(operation.message).toMatch(/EXPTIME 3\.200000E-5/)
  })
})

