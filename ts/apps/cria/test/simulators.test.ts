/**
 * Scenarios against real INDI simulators (libindi 2.2.5): one indiserver with
 * the CCD, telescope, focuser and weather simulators, one Cria, driven over
 * HTTP as Vela drives it.
 */
import { readdirSync, readlinkSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startIndiServer, type RunningIndiServer } from '../../../testing/indiserver.js'
import { allReady, startCria, until, type Cria, type State } from './harness.js'

let indi: RunningIndiServer
let cria: Cria

const devices = [
  { id: 'primary', kind: 'camera', indiDevice: 'CCD Simulator', connect: true },
  { id: 'mount', kind: 'mount', indiDevice: 'Telescope Simulator', connect: true },
  { id: 'focuser', kind: 'focuser', indiDevice: 'Focuser Simulator', connect: true },
  { id: 'weather', kind: 'weather', indiDevice: 'Weather Simulator', connect: true },
] as const

beforeAll(async () => {
  indi = await startIndiServer(['indi_simulator_ccd', 'indi_simulator_telescope', 'indi_simulator_focus', 'indi_simulator_weather'])
  cria = await startCria(indi.port, devices)
  await cria.waitFor(allReady(devices.map(device => device.id)))
})

afterAll(async () => {
  await cria?.stop()
  await indi?.stop()
})

async function commandAsAnotherClient(device: string, property: string, xml: string, seenByCria: (state: State) => boolean) {
  const socket = net.connect(indi.port, '127.0.0.1')
  let received = ''

  socket.on('data', chunk => void (received += String(chunk)))
  await new Promise(resolve => socket.once('connect', resolve))
  socket.write(`<getProperties version="1.7" device="${device}"/>\n`)
  await until(`${device} to define ${property} for the other client`, () => received.includes(`name="${property}"`), 5000)
  received = ''
  socket.write(xml)
  await until(`${device} to answer the other client`, () => new RegExp(`<set\\w+Vector[^>]*name="${property}"`).test(received), 5000)
  socket.destroy()
  await cria.waitFor(seenByCria)
}

async function listen(device: string, property: string) {
  const socket = net.connect(indi.port, '127.0.0.1')
  const updates: string[] = []
  let buffer = ''

  await new Promise(resolve => socket.once('connect', resolve))
  socket.on('data', chunk => {
    buffer += String(chunk)
    let end: number

    while ((end = buffer.indexOf('</setNumberVector>')) >= 0) {
      const vector = buffer.slice(buffer.indexOf('<setNumberVector'), end)

      buffer = buffer.slice(end + '</setNumberVector>'.length)
      if (vector.includes(`device="${device}"`) && vector.includes(`name="${property}"`))
        updates.push(`${/state="(\w+)"/.exec(vector)![1]} ${Number(/<oneNumber[^>]*>([^<]*)</.exec(vector)![1])}`)
    }
  })
  socket.write(`<getProperties version="1.7" device="${device}" name="${property}"/>\n`)

  return { updates, close: () => socket.destroy() }
}

describe('camera', () => {
  it('captures a frame whose original downloads as ImageBytes with the advertised size and digest', async () => {
    const camera = await cria.device('primary')
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.5, light: true })

    expect(operation).toMatchObject({ kind: 'confirmed', state: 'settled', quarantined: false })
    expect([camera.readings.width, camera.readings.height]).toMatchObject([
      { status: 'fresh', value: 1280 },
      { status: 'fresh', value: 1024 },
    ])
    expect(operation.image).toMatchObject({ width: 1280, height: 1024, color: 'mono' })

    const response = await fetch(cria.base + operation.image!.original.url)
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')

    expect(response.headers.get('content-type')).toBe('application/imagebytes')
    expect(Number(response.headers.get('content-length'))).toBe(operation.image!.original.bytes)
    expect(digest).toBe(operation.image!.sha256)
    expect([bytes.readInt32LE(32), bytes.readInt32LE(36)]).toEqual([operation.image!.width, operation.image!.height])
  })

  it('answers 404 not-found for a malformed image id', async () => {
    const refused = await cria.client.refusedOriginal('not-an-image-id')

    expect(refused).toMatchObject({ status: 404, body: { error: { code: 'not-found' } } })
  })

  it('answers 410 image-gone for a well-formed image id it does not hold', async () => {
    const refused = await cria.client.refusedOriginal(crypto.randomUUID())

    expect(refused).toMatchObject({ status: 410, body: { error: { code: 'image-gone' } } })
  })

  it('closes the image file when Vela hangs up mid-download (review R2 P1-A)', async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.2, light: true })
    const url = new URL(cria.base + operation.image!.original.url)
    const openOnImage = () =>
      readdirSync('/proc/self/fd').filter(fd => {
        try {
          return readlinkSync(`/proc/self/fd/${fd}`).endsWith('.imagebytes')
        } catch {
          return false
        }
      }).length

    // Read one chunk of the 2.6 MB frame, then cut the connection.
    await new Promise<void>(resolve => {
      const request = http.get(url, response => {
        response.once('data', () => {
          request.destroy()
          resolve()
        })
      })

      request.on('error', () => undefined)
    })

    // A leaked FileHandle stays open until garbage collection, where Node 26 throws.
    await until('the image file to close', () => openOnImage() === 0, 5000)
  })

  it('keeps readings current while the camera exposes (no refresh-pending for the whole frame)', async () => {
    const submitted = await cria.submit('primary', 'capture', { exposureSeconds: 3, light: true })

    await until('the capture to be 1.5 s into its exposure', async () => {
      const reply = await cria.client.operation(submitted.body.id)

      const elapsed = reply.ok && reply.body.state === 'running' ? reply.body.progress.elapsedSeconds : null

      return elapsed !== null && elapsed >= 1.5
    })
    const camera = await cria.device('primary')

    // Busy because of the exposure, yet every reading is fresh: no "refresh pending" for the whole frame.
    expect(camera.availability).toMatchObject({ ready: false, reason: 'busy' })
    expect(camera.readings.activity).toMatchObject({ status: 'fresh', value: 'exposing' })
    expect(camera.readings.temperatureC).toMatchObject({ status: 'fresh' })

    await cria.settled(submitted.body.id)
  })

  it('refuses a second capture while one runs: busy, nothing queued', async () => {
    const first = await cria.submit('primary', 'capture', { exposureSeconds: 1, light: true })
    const second = await cria.submit('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(second).toMatchObject({ status: 409, body: { error: { code: 'device-busy' } } })
    expect((await cria.settled(first.body.id)).kind).toBe('confirmed')
  })

  it('a cancel mid-exposure aborts, confirms the camera idle, and ends stopped', async () => {
    const submitted = await cria.submit('primary', 'capture', { exposureSeconds: 10, light: true })

    await cria.waitFor(state => state.devices.find(device => device.id === 'primary')!.readings.activity.value === 'exposing')
    await cria.cancel(submitted.body.id)
    const operation = await cria.settled(submitted.body.id)

    expect(operation).toMatchObject({ kind: 'stopped', state: 'settled', quarantined: false })
    const camera = await cria.waitFor(allReady(['primary']))

    expect(camera.devices.find(device => device.id === 'primary')!.readings.activity.value).toBe('idle')
  })

  it('reports busy, without touching the camera, while another INDI client is exposing', async () => {
    await commandAsAnotherClient(
      'CCD Simulator',
      'CCD_EXPOSURE',
      '<newNumberVector device="CCD Simulator" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">3</oneNumber></newNumberVector>\n',
      state => state.devices.find(device => device.id === 'primary')!.readings.activity.value === 'exposing',
    )
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled', quarantined: false })
    expect(operation.message).toMatch(/not idle/)
    await cria.waitFor(allReady(['primary']))
  })

  it('runs one request ID once and refuses the same ID with different content', async () => {
    const requestId = crypto.randomUUID()
    const first = await cria.submit('focuser', 'focuser-move', { position: 50100, minPosition: 1, maxPosition: 90000 }, requestId)
    const again = await cria.submit('focuser', 'focuser-move', { position: 50100, minPosition: 1, maxPosition: 90000 }, requestId)
    const changed = await cria.submit('focuser', 'focuser-move', { position: 50200, minPosition: 1, maxPosition: 90000 }, requestId)

    expect(again.body.id).toBe(first.body.id)
    expect(changed).toMatchObject({ status: 409, body: { error: { code: 'request-conflict' } } })
    expect((await cria.client.byRequest((await cria.state()).instanceId, requestId)).body).toMatchObject({ id: first.body.id })
    await cria.settled(first.body.id)
  })
})

describe('focuser', () => {
  it('moves to the target and reports the confirmed position', async () => {
    await cria.waitFor(allReady(['focuser']))
    const operation = await cria.run('focuser', 'focuser-move', { position: 51234, minPosition: 1, maxPosition: 90000 })

    expect(operation).toMatchObject({ kind: 'confirmed', values: { position: 51234 } })
  })

  it('refuses a target past the mechanical limit before sending anything', async () => {
    await cria.waitFor(allReady(['focuser']))
    const position = await listen('Focuser Simulator', 'ABS_FOCUS_POSITION')

    try {
      const refused = await cria.run('focuser', 'focuser-move', { position: 100000, minPosition: 1, maxPosition: 2_000_000 })

      expect(refused).toMatchObject({ kind: 'failed', reason: 'invalid', message: 'Focuser target approaches the mechanical limit', quarantined: false })

      await cria.waitFor(allReady(['focuser']))
      expect(await cria.run('focuser', 'focuser-move', { position: 50500, minPosition: 1, maxPosition: 90000 })).toMatchObject({ kind: 'confirmed' })
      expect(position.updates[0]).toBe('Ok 50500')
    } finally {
      position.close()
    }
  })
})

describe('mount', () => {
  it('tracks, slews in its own frame (JNow), and refuses another frame before moving', async () => {
    await cria.waitFor(allReady(['mount']))
    expect(await cria.run('mount', 'mount-tracking', { tracking: true })).toMatchObject({ kind: 'confirmed' })

    const refused = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: 30, declinationDegrees: 20, coordinateSystem: 'j2000' })

    expect(refused).toMatchObject({ kind: 'failed', state: 'settled' })
    expect(refused.message).toMatch(/frame/)

    // Aim near where the mount points now, so the slew's length doesn't depend on the time of day.
    const ra = (Number((await cria.device('mount')).readings.rightAscensionHours!.value) * 15 + 10) % 360
    const slew = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: ra, declinationDegrees: 75, coordinateSystem: 'topocentric' })

    expect([slew.kind, slew.message]).toEqual(['confirmed', null])
    expect(Number(slew.values!.rightAscensionDegrees)).toBeCloseTo(ra, 0)
  })

  it('a cancelled slew stops the mount and ends cancelled', async () => {
    await cria.waitFor(allReady(['mount']))
    const submitted = await cria.submit('mount', 'mount-slew', { rightAscensionDegrees: 200, declinationDegrees: -30, coordinateSystem: 'topocentric' })

    await cria.waitFor(state => state.devices.find(device => device.id === 'mount')!.readings.slewing!.value === true)
    await cria.cancel(submitted.body.id)
    const operation = await cria.settled(submitted.body.id)

    expect(operation).toMatchObject({ kind: 'stopped', state: 'settled' })
    expect((await cria.device('mount')).readings.slewing!.value).toBe(false)
  })
})

describe('weather', () => {
  it('reports what the device has and marks the rest unsupported', async () => {
    const weather = await cria.device('weather')

    expect(weather.readings.temperatureC).toMatchObject({ status: 'fresh', value: 15 })
    expect(weather.readings.pressureHpa).toEqual({ status: 'unavailable', reason: 'unsupported' })
  })
})
