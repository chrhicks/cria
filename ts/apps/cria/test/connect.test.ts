import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, addCamera, addMount, connection } from '@cria/fake-indi'
import { propertyOf, startCria, until, type Cria } from './harness.js'

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

const disconnect = (device: string) => fake.update(device, 'CONNECTION', { values: { CONNECT: false, DISCONNECT: true } })

async function start(devices: Parameters<typeof startCria>[1], overrides: object = {}) {
  cria = await startCria(fake.port, devices, overrides)
  for (const device of devices) await until(`Cria to see ${device.indiDevice}`, () => propertyOf(cria, device.indiDevice, 'CONNECTION'))
}

describe('a camera', () => {
  it('is connected and switched to upload frames to the client', async () => {
    fake = new FakeIndi()
    await fake.start()
    addCamera(fake, camera, { width: 8, height: 6, upload: 'local' })
    disconnect(camera)
    await start([{ id: 'primary', kind: 'camera', indiDevice: camera }])

    expect(await cria.connect('primary')).toEqual({ outcome: 'confirmed', setup: 'sent UPLOAD_MODE UPLOAD_CLIENT=On' })
    expect(fake.vector(camera, 'CONNECTION').elements.CONNECT!.value).toBe(true)
    expect(fake.vector(camera, 'UPLOAD_MODE').elements.UPLOAD_CLIENT!.value).toBe(true)
  })

  it('already uploading to the client is left alone', async () => {
    fake = new FakeIndi()
    await fake.start()
    addCamera(fake, camera)
    await start([{ id: 'primary', kind: 'camera', indiDevice: camera }])

    expect(await cria.connect('primary')).toEqual({ outcome: 'confirmed', setup: 'UPLOAD_MODE already set' })
    expect(writes('CONNECTION')).toEqual([])
    expect(writes('UPLOAD_MODE')).toEqual([])
  })

  it('is disconnected without any setup', async () => {
    fake = new FakeIndi()
    await fake.start()
    addCamera(fake, camera)
    await start([{ id: 'primary', kind: 'camera', indiDevice: camera }])

    expect(await cria.connect('primary', false)).toEqual({ outcome: 'confirmed' })
    expect(fake.vector(camera, 'CONNECTION').elements.DISCONNECT!.value).toBe(true)
    expect(writes('UPLOAD_MODE')).toEqual([])
  })

  it('skips and names a property its driver does not define', async () => {
    fake = new FakeIndi()
    await fake.start()
    fake.define(connection(camera))
    await start([{ id: 'primary', kind: 'camera', indiDevice: camera }], { definitionWaitMs: 100 })

    expect(await cria.connect('primary')).toEqual({ outcome: 'confirmed', setup: 'UPLOAD_MODE skipped: not defined' })
  })
})

describe('a mount', () => {
  it('gets the configured site, in INDI longitude, then the time', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.update(mount, 'GEOGRAPHIC_COORD', { values: { LAT: 0, LONG: 0, ELEV: 0 } })
    disconnect(mount)
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount, site }])

    const result = await cria.connect('mount')

    expect(result.outcome).toBe('confirmed')
    expect(result.setup).toMatch(/^sent GEOGRAPHIC_COORD LAT=33.45 LONG=247.93\d* ELEV=331; sent TIME_UTC UTC=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d OFFSET=0.00$/)
    expect(fake.received.filter(xml => /name="(GEOGRAPHIC_COORD|TIME_UTC)"/.test(xml)).map(xml => (xml.includes('GEOGRAPHIC_COORD') ? 'site' : 'time'))).toEqual(['site', 'time'])
    expect(Math.abs(Date.parse(`${String(fake.vector(mount, 'TIME_UTC').elements.UTC!.value)}Z`) - Date.now())).toBeLessThan(15_000)
  })

  it('waits for the site and time its driver defines only after connecting', async () => {
    fake = new FakeIndi()
    await fake.start()
    fake.define(connection(mount, false))
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount, site }])

    const result = cria.connect('mount')

    await until('the mount to connect', () => fake.vector(mount, 'CONNECTION').elements.CONNECT!.value === true || undefined)
    fake.define({ device: mount, name: 'GEOGRAPHIC_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { LAT: { value: 0, min: -90, max: 90 }, LONG: { value: 0, max: 360 }, ELEV: { value: 0, min: -200, max: 10000 } } })
    fake.define({ device: mount, name: 'TIME_UTC', kind: 'text', perm: 'rw', state: 'Ok', elements: { UTC: { value: '2000-01-01T00:56:31' }, OFFSET: { value: '0.00' } } })

    expect((await result).setup).toMatch(/^sent GEOGRAPHIC_COORD .*; sent TIME_UTC /)
  })

  it('sets the time only when no site is configured', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount }])

    await cria.connect('mount')

    expect(writes('GEOGRAPHIC_COORD')).toEqual([])
    expect(writes('TIME_UTC')).toHaveLength(1)
  })

  it('is uncertain when the driver never answers a setup write', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.behaviour = (_fake, vector) => (vector.name === 'TIME_UTC' ? 'handled' : 'default')
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount }], { confirmMs: 1000 })

    expect(await cria.connect('mount')).toMatchObject({ outcome: 'uncertain', message: expect.stringContaining('setup: TIME_UTC') })
    expect(writes('TIME_UTC')).toHaveLength(1)
  })

  it('fails when the driver answers a setup write with Alert, and sends nothing after it', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.behaviour = (fake, vector) => {
      if (vector.name !== 'GEOGRAPHIC_COORD') return 'default'
      fake.update(mount, vector.name, { state: 'Alert', message: 'bad site' })

      return 'handled'
    }
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount, site }])

    expect(await cria.connect('mount')).toEqual({ outcome: 'failed', message: 'setup: GEOGRAPHIC_COORD on ZWO AM5: bad site' })
    expect(writes('TIME_UTC')).toEqual([])
  })

  it('turns driver debug on, and its level, when asked', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.define({ device: mount, name: 'DEBUG', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { ENABLE: { value: false }, DISABLE: { value: true } } })
    fake.define({ device: mount, name: 'DEBUG_LEVEL', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { DBG_DEBUG: { value: false } } })
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount, driverDebug: true }])

    await cria.connect('mount')

    expect(fake.vector(mount, 'DEBUG').elements.ENABLE!.value).toBe(true)
    expect(fake.vector(mount, 'DEBUG_LEVEL').elements.DBG_DEBUG!.value).toBe(true)
  })

  it('leaves driver debug alone unless asked', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.define({ device: mount, name: 'DEBUG', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { ENABLE: { value: false }, DISABLE: { value: true } } })
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount }])

    await cria.connect('mount')

    expect(writes('DEBUG')).toEqual([])
  })

  it('has its serial port set before the connection, when the config names one', async () => {
    fake = new FakeIndi()
    await fake.start()
    addMount(fake, mount)
    fake.define({ device: mount, name: 'DEVICE_PORT', kind: 'text', perm: 'rw', state: 'Ok', elements: { PORT: { value: '/dev/ttyUSB0' } } })
    disconnect(mount)
    await start([{ id: 'mount', kind: 'mount', indiDevice: mount, port: '/dev/serial/by-id/am5' }])

    await cria.connect('mount')

    expect(fake.received.filter(xml => /name="(DEVICE_PORT|CONNECTION)"/.test(xml) && xml.startsWith('<new')).map(xml => (xml.includes('DEVICE_PORT') ? 'port' : 'connection'))).toEqual(['port', 'connection'])
    expect(fake.vector(mount, 'DEVICE_PORT').elements.PORT!.value).toBe('/dev/serial/by-id/am5')
  })
})

describe('a device indiserver does not define', () => {
  it('fails, naming the device', async () => {
    fake = new FakeIndi()
    await fake.start()
    addCamera(fake, camera)
    cria = await startCria(fake.port, [{ id: 'other', kind: 'camera', indiDevice: 'Not There' }])

    expect(await cria.connect('other')).toEqual({ outcome: 'failed', message: 'Not There is not defined by indiserver' })
  })
})
