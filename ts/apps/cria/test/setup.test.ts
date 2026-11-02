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
    { label: 'matching', state: 'Ok', latitude: 12.5, longitude: 0, elevation: 123 },
    { label: 'rounded', state: 'Ok', latitude: 12.50009, longitude: 0.00009, elevation: 123.9 },
    { label: 'wrapped', state: 'Ok', latitude: 12.5, longitude: 359.99995, elevation: 123 },
    { label: 'different latitude', state: 'Ok', latitude: 12.501, longitude: 0, elevation: 123 },
    { label: 'different longitude', state: 'Ok', latitude: 12.5, longitude: 0.001, elevation: 123 },
    { label: 'different elevation', state: 'Ok', latitude: 12.5, longitude: 0, elevation: 125 },
    { label: 'Alert matching', state: 'Alert', latitude: 12.5, longitude: 0, elevation: 123 },
    { label: 'Alert different', state: 'Alert', latitude: 12.501, longitude: 0, elevation: 123 },
    { label: 'Idle matching', state: 'Idle', latitude: 12.5, longitude: 0, elevation: 123 },
    { label: 'Busy matching', state: 'Busy', latitude: 12.5, longitude: 0, elevation: 123 },
    { label: 'unparsable latitude', state: 'Alert', latitude: 'invalid', longitude: 0, elevation: 123 },
    { label: 'unread latitude', state: 'Ok', latitude: undefined, longitude: 0, elevation: 123 },
  ] as const)('handles an already reported $label site', async ({ state, latitude, longitude, elevation }) => {
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

    expect(writes('GEOGRAPHIC_COORD')).toHaveLength(1)
    expect(writes('TIME_UTC')).toHaveLength(1)
    const startup = (await cria.state()).operations.find(operation => operation.requestId.startsWith('startup-'))
    expect(startup).toMatchObject({ state: 'settled', outcome: { kind: 'confirmed' } })
    expect(fake.received.filter(xml => xml.startsWith('<new') && /name="(GEOGRAPHIC_COORD|TIME_UTC)"/.test(xml)).map(xml => xml.includes('GEOGRAPHIC_COORD') ? 'site' : 'time')).toEqual(['site', 'time'])
  })

  it.each(['GEOGRAPHIC_COORD', 'TIME_UTC'])('fails without holding when %s gets no answer', async property => {
    await start((fake, vector, values) => (vector.name === property ? 'handled' : moveMount()(fake, vector, values)))
    await until('the setup write to be sent', () => writes(property).length > 0)
    const during = (await cria.device('mount')).availability
    await cria.waitFor(allReady(['mount']))
    const device = await cria.device('mount')
    const startup = (await cria.state()).operations.find(operation => operation.requestId.startsWith('startup-'))

    expect(during).toEqual({ ready: false, reason: 'starting', message: 'Waiting for device setup' })
    expect(device.quarantine.held).toBe(false)
    expect(startup).toMatchObject({ state: 'settled', outcome: { kind: 'failed', reason: 'unavailable', message: expect.stringContaining(`setup: ${property}`) } })
    expect(writes(property)).toHaveLength(1)
    if (property === 'GEOGRAPHIC_COORD') expect(writes('TIME_UTC')).toHaveLength(0)
  })

  it('gives actionable advice for a refused goto even after setup confirmed, without retrying it', async () => {
    await start((fake, vector, values) => {
      if (vector.name === 'EQUATORIAL_EOD_COORD') {
        fake.update(mount, vector.name, { state: 'Alert' })
        return 'handled'
      }
      return moveMount()(fake, vector, values)
    })
    await cria.waitFor(allReady(['mount']))
    const outcome = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: 120, declinationDegrees: 20, coordinateSystem: 'topocentric' })

    expect(outcome).toMatchObject({ kind: 'failed', reason: 'rejected', quarantined: false })
    expect(outcome.message).toContain('Nothing moved')
    expect(outcome.message).toContain('AM5 e7')
    expect(outcome.message).toContain('device-connect')
    expect(outcome.message).toContain('connected: true')
    expect(writes('EQUATORIAL_EOD_COORD')).toHaveLength(1)
    expect([writes('GEOGRAPHIC_COORD').length, writes('TIME_UTC').length]).toEqual([1, 1])
  })

  it('writes again after a Cria restart with the stored site, without changing tracking', async () => {
    await start()
    await cria.waitFor(allReady(['mount']))
    const tracking = fake.vector(mount, 'TELESCOPE_TRACK_STATE').elements.TRACK_ON!.value
    await cria.stop()
    cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, site }])
    await cria.waitFor(allReady(['mount']))

    expect([writes('GEOGRAPHIC_COORD').length, writes('TIME_UTC').length]).toEqual([2, 2])
    expect(writes('TELESCOPE_TRACK_STATE')).toHaveLength(0)
    expect(fake.vector(mount, 'TELESCOPE_TRACK_STATE').elements.TRACK_ON!.value).toBe(tracking)
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
