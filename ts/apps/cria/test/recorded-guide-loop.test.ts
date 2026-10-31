/**
 * Frames Cria never asked for, as errai recorded them on 2026-10-27 between 00:31 and
 * 02:07 UTC: PHD2 looped 2 s exposures on the guide camera (1,027 frames) while Cria
 * held both cameras. The loop is `guideLoop` in drivers.ts, on the recorded cadence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera } from '@cria/fake-indi'
import { exposeNormally, guideLoop } from './drivers.js'
import { allReady, noneNotRead, startCria, until, type Cria } from './harness.js'

const primary = 'ZWO CCD ASI2600MC Pro'
const guide = 'ZWO CCD ASI220MM Mini'
let fake: FakeIndi
let cria: Cria

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addCamera(fake, primary)
  addCamera(fake, guide, { width: 8, height: 6, mono: true })
  fake.behaviour = exposeNormally()
  cria = await startCria(
    fake.port,
    [
      { id: 'primary', kind: 'camera', indiDevice: primary },
      { id: 'guide', kind: 'camera', indiDevice: guide },
    ],
    { acknowledgeMs: 600 },
  )
  await cria.waitFor(allReady(['primary', 'guide']))
  await cria.waitFor(noneNotRead)
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

const wrote = (device: string) => fake.received.filter(xml => xml.startsWith('<new') && xml.includes(`device="${device}"`) && xml.includes('name="CCD_EXPOSURE"')).length

describe('another client looping exposures on the guide camera', () => {
  it('delivers frames Cria did not ask for; Cria takes its own frame on the other camera and holds neither', async () => {
    const loop = guideLoop(fake, guide, { exposureSeconds: 0.4, readoutMs: 100, gapMs: 57 })

    await until('two guide frames to arrive', () => loop.frames() >= 2, 10_000)
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.3, light: true })

    expect(operation).toMatchObject({ kind: 'confirmed', quarantined: false })
    await until('two more guide frames to arrive', () => loop.frames() >= 4, 10_000)

    const state = await cria.state()

    expect(state.devices.map(device => [device.id, device.quarantine.held, device.availability.ready])).toEqual([
      ['primary', false, true],
      ['guide', false, true],
    ])
    // Cria wrote one exposure, on the camera it was asked to use, and none on the guide camera.
    expect([wrote(primary), wrote(guide)]).toEqual([1, 0])
    // Only the frame Cria asked for is an image; none of the loop's frames became one.
    expect(state.operations.filter(candidate => candidate.state === 'settled').length).toBe(1)
    loop.stop()
  }, 30_000)
})
