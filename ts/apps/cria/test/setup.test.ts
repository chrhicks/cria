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
    fake.update(mount, 'GEOGRAPHIC_COORD', { values: { LAT: 0, LONG: 0, ELEV: 0 } })
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

  it.each([
    { label: 'matching', state: 'Ok', latitude: 12.5, longitude: 0, elevation: 123, kept: true },
    { label: 'rounded', state: 'Ok', latitude: 12.50009, longitude: 0.00009, elevation: 123.9, kept: true },
    { label: 'wrapped', state: 'Ok', latitude: 12.5, longitude: 359.99995, elevation: 123, kept: true },
    { label: 'different latitude', state: 'Ok', latitude: 12.501, longitude: 0, elevation: 123, kept: false },
    { label: 'different longitude', state: 'Ok', latitude: 12.5, longitude: 0.001, elevation: 123, kept: false },
    { label: 'different elevation', state: 'Ok', latitude: 12.5, longitude: 0, elevation: 125, kept: false },
    { label: 'Alert matching', state: 'Alert', latitude: 12.5, longitude: 0, elevation: 123, kept: true },
    { label: 'Alert different', state: 'Alert', latitude: 12.501, longitude: 0, elevation: 123, kept: false },
    { label: 'Idle matching', state: 'Idle', latitude: 12.5, longitude: 0, elevation: 123, kept: true },
    { label: 'Busy matching', state: 'Busy', latitude: 12.5, longitude: 0, elevation: 123, kept: true },
    { label: 'unparsable latitude', state: 'Alert', latitude: 'invalid', longitude: 0, elevation: 123, kept: false },
    { label: 'unread latitude', state: 'Ok', latitude: undefined, longitude: 0, elevation: 123, kept: false },
  ] as const)('handles an already reported $label site', async ({ state, latitude, longitude, elevation, kept }) => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.update(mount, 'GEOGRAPHIC_COORD', { state, values: { LAT: latitude ?? 12.5, LONG: longitude, ELEV: elevation } })
    if (latitude === undefined || typeof latitude === 'string') delete fake.vector(mount, 'GEOGRAPHIC_COORD').elements.LAT
    fake.behaviour = (fake, vector, values) => {
      if (typeof latitude === 'string' && vector.name === 'CONNECTION') {
        fake.apply(vector, values)
        fake.update(mount, 'CONNECTION', { state: 'Ok' })
        fake.raw('<setNumberVector device="ZWO AM5" name="GEOGRAPHIC_COORD" state="Alert"><oneNumber name="LAT">invalid</oneNumber></setNumberVector>', mount, 'GEOGRAPHIC_COORD')
        return 'handled'
      }
      return moveMount()(fake, vector, values)
    }
    cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, site: { latitudeDegrees: 12.5, longitudeDegrees: 0, elevationMeters: 123 } }])
    if (latitude === undefined || typeof latitude === 'string') {
      await until('the unread site to be written', () => writes('GEOGRAPHIC_COORD').length > 0)
      expect(writes('GEOGRAPHIC_COORD')).toHaveLength(1)
      return
    }
    await cria.waitFor(allReady(['mount']))

    expect(writes('GEOGRAPHIC_COORD')).toHaveLength(kept ? 0 : 1)
    expect(writes('TIME_UTC')).toHaveLength(1)
    const startup = (await cria.state()).operations.find(operation => operation.requestId.startsWith('startup-'))
    expect(startup).toMatchObject({ state: 'settled', outcome: { kind: 'confirmed' } })
    if (kept) expect(JSON.stringify(startup)).toContain('GEOGRAPHIC_COORD already set to the configured site')
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
    fake.update(mount, 'GEOGRAPHIC_COORD', { values: { LAT: 0, LONG: 0, ELEV: 0 } })
    await cria.waitFor(allReady(['mount']))

    expect([writes('GEOGRAPHIC_COORD').length, writes('TIME_UTC').length]).toEqual([2, 2])
  })
})
