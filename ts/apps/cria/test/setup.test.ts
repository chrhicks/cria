import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera, addMount } from '@cria/fake-indi'
import { exposeNormally, moveMount } from './drivers.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const camera = 'Fake CCD'
const mount = 'ZWO AM5'
const site = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
let fake: FakeIndi
let cria: Cria

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

const writes = (property: string) => fake.received.filter(xml => xml.startsWith('<new') && xml.includes(`name="${property}"`))

describe('a camera that saves frames locally', () => {
  it('is switched to upload to Cria once it connects, and then captures', async () => {
    fake = new FakeIndi()
    await fake.start()
    addCamera(fake, camera, { width: 8, height: 6, upload: 'local' })
    fake.behaviour = exposeNormally()
    cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }])
    await cria.waitFor(allReady(['primary']))

    const capture = await cria.run('primary', 'capture', { exposureSeconds: 0.05, light: true })
    const startup = (await cria.state()).operations.find(operation => operation.requestId.startsWith('startup-'))

    expect(capture.kind).toBe('confirmed')
    expect(writes('UPLOAD_MODE')).toHaveLength(1)
    expect(fake.vector(camera, 'UPLOAD_MODE').elements.UPLOAD_CLIENT!.value).toBe(true)
    expect(startup).toMatchObject({
      kind: 'device-connect',
      state: 'settled',
      outcome: { kind: 'confirmed', value: { values: { connected: true, setup: 'sent UPLOAD_MODE UPLOAD_CLIENT=On' } } },
    })
  })

  it('already uploading to Cria is left alone: nothing sent, no operation', async () => {
    fake = new FakeIndi()
    await fake.start()
    addCamera(fake, camera)
    fake.behaviour = exposeNormally()
    cria = await startCria(fake.port, [{ id: 'primary', kind: 'camera', indiDevice: camera }])
    await cria.waitFor(allReady(['primary']))

    expect([writes('UPLOAD_MODE'), (await cria.state()).operations]).toEqual([[], []])
  })
})

describe('a mount', () => {
  async function start(behaviour = moveMount()) {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.behaviour = behaviour
    cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, site }], { acknowledgeMs: 600 })
  }

  it('gets the configured site (INDI longitude 0-360 east), then the time, and is ready', async () => {
    await start()
    await cria.waitFor(allReady(['mount']))

    expect(writes('GEOGRAPHIC_COORD').map(xml => [...xml.matchAll(/name="(\w+)">\s*([^<\s]+)/g)].map(([, name, value]) => `${name}=${value}`))).toEqual([
      ['LAT=33.45', 'LONG=247.93', 'ELEV=331'],
    ])
    expect(fake.vector(mount, 'TIME_UTC').elements.UTC!.value).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/)
    expect(Math.abs(Date.parse(`${String(fake.vector(mount, 'TIME_UTC').elements.UTC!.value)}Z`) - Date.now())).toBeLessThan(15_000)
  })

  it('is not ready while its setup runs, and a setup write the driver never answers blocks it until a person recovers it', async () => {
    await start((fake, vector, values) => (vector.name === 'TIME_UTC' ? 'handled' : moveMount()(fake, vector, values)))
    await until('the time to be sent', () => writes('TIME_UTC').length > 0)
    const during = (await cria.device('mount')).availability

    await cria.waitFor(state => state.devices[0]!.quarantine.held)
    const blocked = await cria.device('mount')

    expect(during).toEqual({ ready: false, reason: 'starting', message: 'Waiting for device setup' })
    expect(blocked.availability).toMatchObject({ ready: false, reason: 'blocked' })
    expect(blocked.availability.ready === false && blocked.availability.message).toMatch(/^Blocked until a person recovers it: setup: TIME_UTC on ZWO AM5: no answer/)
    expect(writes('TIME_UTC')).toHaveLength(1)
  })

  it('is set up again when its driver comes back after going away', async () => {
    await start()
    await cria.waitFor(allReady(['mount']))
    fake.removeDevice(mount)
    await cria.waitFor(state => state.devices[0]!.availability.ready === false)
    addMount(fake, mount)
    await cria.waitFor(allReady(['mount']))

    expect([writes('GEOGRAPHIC_COORD').length, writes('TIME_UTC').length]).toEqual([2, 2])
  })
})
