import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera, zwoFrames } from './fake-indi.js'
import { allReady, noneNotRead, startCria, valueOf, type Cria, type DeviceSpec } from './harness.js'

const camera = 'Fake ASI'
let fake: FakeIndi
let cria: Cria

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

function deployed(id: 'primary' | 'guide'): DeviceSpec {
  const rig: { devices: ReadonlyArray<DeviceSpec> } = JSON.parse(readFileSync(new URL('../../../deploy/rig.errai.json', import.meta.url), 'utf8'))

  return { ...rig.devices.find(device => device.id === id)!, id: 'camera', indiDevice: camera }
}

const unconfigured: DeviceSpec = { id: 'camera', kind: 'camera', indiDevice: camera }

async function start(sensor: Parameters<typeof addCamera>[2], spec: DeviceSpec, overrides: object = {}) {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, camera, sensor)
  fake.define({
    device: camera,
    name: 'CCD_CONTROLS',
    kind: 'number',
    perm: 'rw',
    state: 'Ok',
    elements: { Gain: { value: 100, min: 0, max: 700, step: 1 }, Offset: { value: 0, min: 0, max: 240, step: 1 } },
  })
  fake.behaviour = zwoFrames({ grid: { width: 8, height: 2 }, recomputeMs: 300, echoMs: 100 })
  cria = await startCria(fake.port, [spec], overrides)
  await cria.waitFor(allReady(['camera']))
  await cria.waitFor(noneNotRead)
}

const frame = () => Object.fromEntries(Object.entries(fake.vector(camera, 'CCD_FRAME').elements).map(([element, { value }]) => [element, value]))
const sent = (property: string) => fake.received.filter(xml => xml.startsWith('<new') && xml.includes(`name="${property}"`)).length

describe('camera-configure on a 6248x4176 ASI2600-like sensor', () => {
  const asi2600 = { width: 6248, height: 4176 }

  it('changes only the binning when only the binning is asked, and reports the frame the driver recomputed', async () => {
    await start(asi2600, deployed('primary'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2 })

    expect([operation.kind, operation.message]).toEqual(['confirmed', null])
    expect(operation.values).toEqual({ binX: 2, binY: 2, startX: 0, startY: 0, width: 3120, height: 2088 })
    expect(frame()).toEqual({ X: 0, Y: 0, WIDTH: 6240, HEIGHT: 4176 })
    expect([sent('CCD_BINNING'), sent('CCD_FRAME')]).toEqual([1, 0])
  })

  it('takes 3120x2088 binned pixels with a binning change, and confirms the final frame, not the recompute on the way', async () => {
    await start(asi2600, deployed('primary'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 3120, height: 2088, startX: 0, startY: 0 })

    expect([operation.kind, operation.message]).toEqual(['confirmed', null])
    expect(operation.values).toEqual({ binX: 2, binY: 2, startX: 0, startY: 0, width: 3120, height: 2088 })
    expect(frame()).toEqual({ X: 0, Y: 0, WIDTH: 6240, HEIGHT: 4176 })
  })

  it('restores bin 1 and the full frame from a binned state, with gain and offset', async () => {
    await start(asi2600, deployed('primary'))
    fake.update(camera, 'CCD_BINNING', { state: 'Ok', values: { HOR_BIN: 2, VER_BIN: 2 } })
    await cria.waitFor(state => valueOf(state.devices[0]!, 'binX') === 2)

    const operation = await cria.run('camera', 'camera-configure', { binX: 1, binY: 1, width: 6248, height: 4176, startX: 0, startY: 0, gain: 200, offset: 1 })

    expect([operation.kind, operation.message]).toEqual(['confirmed', null])
    expect(operation.values).toEqual({ binX: 1, binY: 1, startX: 0, startY: 0, width: 6248, height: 4176, gain: 200, offset: 1 })
    expect(frame()).toEqual({ X: 0, Y: 0, WIDTH: 6248, HEIGHT: 4176 })
  })

  it('refuses width 3116 at bin 2, a multiple of 8 sensor pixels but not of 8 binned pixels, before sending anything', async () => {
    await start(asi2600, deployed('primary'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 3116, height: 2088, startX: 0, startY: 0 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'width 3116 binned pixels; the camera needs a multiple of 8 binned pixels; nearest 3112 or 3120',
    ])
    expect([sent('CCD_BINNING'), sent('CCD_FRAME')]).toEqual([0, 0])
  })

  it('refuses the full sensor width 3124 at bin 2, naming only the nearest width that fits', async () => {
    await start(asi2600, deployed('primary'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 3124, height: 2088, startX: 0, startY: 0 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'width 3124 binned pixels; the camera needs a multiple of 8 binned pixels; nearest 3120',
    ])
    expect([sent('CCD_BINNING'), sent('CCD_FRAME')]).toEqual([0, 0])
  })

  it('refuses a region past the edge of the sensor, in binned and sensor pixels', async () => {
    await start(asi2600, deployed('primary'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 3120, startX: 8 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'Subframe exceeds the sensor: startX 8 + width 3120 binned pixels at bin 2 is 6256 sensor pixels; the sensor has 6248',
    ])
    expect([sent('CCD_BINNING'), sent('CCD_FRAME')]).toEqual([0, 0])
  })
})

describe('camera-configure on a 1920x1080 ASI220MM-like mono sensor', () => {
  const asi220 = { width: 1920, height: 1080, maxBin: 2, mono: true }

  it('takes 960x540 at bin 2 as the whole sensor, and the image is 960x540', async () => {
    await start(asi220, deployed('guide'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 960, height: 540, startX: 0, startY: 0 })

    expect(operation.values).toEqual({ binX: 2, binY: 2, startX: 0, startY: 0, width: 960, height: 540 })
    expect(frame()).toEqual({ X: 0, Y: 0, WIDTH: 1920, HEIGHT: 1080 })

    const capture = await cria.run('camera', 'capture', { exposureSeconds: 0.05, light: true })

    expect(capture.image).toMatchObject({ width: 960, height: 540, binX: 2, binY: 2, color: 'mono' })
  })

  it.each([
    [480, 240, 960],
    [472, 244, 944],
  ])('takes a %ix270 region at %i,135 at bin 2 as %ix540 sensor pixels, and the image is that size', async (width, startX, sensorWidth) => {
    await start(asi220, deployed('guide'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width, height: 270, startX, startY: 135 })

    expect([operation.kind, operation.values]).toEqual(['confirmed', { binX: 2, binY: 2, startX, startY: 135, width, height: 270 }])
    expect(frame()).toEqual({ X: startX * 2, Y: 270, WIDTH: sensorWidth, HEIGHT: 540 })

    const capture = await cria.run('camera', 'capture', { exposureSeconds: 0.1, light: true })

    expect([capture.kind, capture.image?.width, capture.image?.height]).toEqual(['confirmed', width, 270])
  })

  it.each([
    [{ width: 476, height: 270 }, 'width 476 binned pixels; the camera needs a multiple of 8 binned pixels; nearest 472 or 480'],
    [{ width: 480, height: 271 }, 'height 271 binned pixels; the camera needs a multiple of 2 binned pixels; nearest 270 or 272'],
  ])('refuses %o at bin 2 before sending anything', async (size, message) => {
    await start(asi220, deployed('guide'))

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, ...size, startX: 0, startY: 0 })

    expect([operation.kind, operation.reason, operation.message]).toEqual(['failed', 'invalid', message])
    expect([sent('CCD_BINNING'), sent('CCD_FRAME')]).toEqual([0, 0])
  })

  it('refuses a new binning that would put the width it keeps off the grid', async () => {
    await start(asi220, deployed('guide'))
    fake.update(camera, 'CCD_FRAME', { state: 'Ok', values: { WIDTH: 1912 } })
    await cria.waitFor(state => valueOf(state.devices[0]!, 'width') === 1912)

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, startX: 0, startY: 0 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'width 956 binned pixels (the current width); the camera needs a multiple of 8 binned pixels; nearest 952 or 960',
    ])
    expect([sent('CCD_BINNING'), sent('CCD_FRAME')]).toEqual([0, 0])
  })

  it("converts a step the driver advertises in sensor pixels to binned pixels", async () => {
    await start({ ...asi220, widthStep: 16 }, unconfigured)

    const operation = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 476, height: 270, startX: 0, startY: 0 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'width 476 binned pixels; the camera needs a multiple of 8 binned pixels; nearest 472 or 480',
    ])
  })
})

describe('a capture after a frame the driver rounded but publishes as asked', () => {
  it('ends failed at the exposure plus the readout allowance, with the exposure aborted, not at the operation timeout', async () => {
    await start({ width: 1920, height: 1080, maxBin: 2, mono: true }, unconfigured, { operationTimeoutMs: 600_000, readoutAllowanceMs: 1000 })

    const configure = await cria.run('camera', 'camera-configure', { binX: 2, binY: 2, width: 476, height: 270, startX: 0, startY: 0 })

    expect([configure.kind, configure.reason, configure.message]).toEqual([
      'failed',
      'rejected',
      'CCD_FRAME on Fake ASI: the driver applied X=0, Y=0, WIDTH=944, HEIGHT=540',
    ])
    await cria.waitFor(state => valueOf(state.devices[0]!, 'width') === 476)

    const startedAt = Date.now()
    const capture = await cria.run('camera', 'capture', { exposureSeconds: 0.1, light: true })

    expect([capture.kind, capture.reason, capture.message, capture.quarantined]).toEqual([
      'failed',
      'unavailable',
      'No frame arrived within the 0.1 s exposure and the 1 s readout allowance',
      false,
    ])
    expect(Date.now() - startedAt).toBeLessThan(5000)
    expect(sent('CCD_ABORT_EXPOSURE')).toBe(1)
    expect(fake.vector(camera, 'CCD_EXPOSURE').state).toBe('Alert')
  }, 20_000)
})
