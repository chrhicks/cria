/**
 * Scenarios against real INDI simulators (libindi 2.2.5): one indiserver with
 * the CCD, telescope, focuser and weather simulators, one Cria, driven over
 * HTTP as Vela drives it.
 */
import { readdirSync, readlinkSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFitsHeader } from '@cria/fits'
import { startIndiServer, type RunningIndiServer } from '../../../testing/indiserver.js'
import { connectDevices, propertyOf, startCria, until, type Cria } from './harness.js'

let indi: RunningIndiServer
let cria: Cria

const devices = [
  { id: 'primary', kind: 'camera', indiDevice: 'CCD Simulator' },
  { id: 'mount', kind: 'mount', indiDevice: 'Telescope Simulator' },
  { id: 'focuser', kind: 'focuser', indiDevice: 'Focuser Simulator' },
  { id: 'box', kind: 'box', indiDevice: 'Weather Simulator' },
] as const

beforeAll(async () => {
  indi = await startIndiServer(['indi_simulator_ccd', 'indi_simulator_telescope', 'indi_simulator_focus', 'indi_simulator_weather'])
  cria = await startCria(indi.port, devices)
  await connectDevices(cria, devices.map(device => device.id))
})

afterAll(async () => {
  await cria?.stop()
  await indi?.stop()
})

async function commandAsAnotherClient(device: string, property: string, xml: string, seenByCria: () => boolean) {
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
  await until('Cria to see it', seenByCria)
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
  it('captures a frame whose original downloads as the camera FITS with the advertised size and digest', async () => {
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 0.5, light: true })

    expect(operation).toMatchObject({ kind: 'confirmed', state: 'settled' })
    expect(operation.image).toMatchObject({ width: 1280, height: 1024, color: 'mono' })

    const response = await fetch(cria.base + operation.image!.original.url)
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')

    expect(response.headers.get('content-type')).toBe('application/fits')
    expect(Number(response.headers.get('content-length'))).toBe(operation.image!.original.bytes)
    expect(digest).toBe(operation.image!.sha256)
    const { cards } = readFitsHeader(bytes)

    expect([Number(cards.get('NAXIS1')), Number(cards.get('NAXIS2'))]).toEqual([operation.image!.width, operation.image!.height])
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
          return readlinkSync(`/proc/self/fd/${fd}`).endsWith('.fits')
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

  it('reports progress while the camera exposes', async () => {
    const submitted = await cria.submit('primary', 'capture', { exposureSeconds: 3, light: true })

    await until('the capture to be 1.5 s into its exposure', async () => {
      const reply = await cria.client.operation(submitted.body.id)

      const elapsed = reply.ok && reply.body.state === 'running' ? reply.body.progress.elapsedSeconds : null

      return elapsed !== null && elapsed >= 1.5
    })
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

    await until('Cria to see the exposure', () => propertyOf(cria, 'CCD Simulator', 'CCD_EXPOSURE')?.state === 'Busy')
    await cria.cancel(submitted.body.id)
    const operation = await cria.settled(submitted.body.id)

    expect(operation).toMatchObject({ kind: 'stopped', state: 'settled' })
    expect(propertyOf(cria, 'CCD Simulator', 'CCD_EXPOSURE')?.state).not.toBe('Busy')
  })

  it('reports busy, without touching the camera, while another INDI client is exposing', async () => {
    await commandAsAnotherClient(
      'CCD Simulator',
      'CCD_EXPOSURE',
      '<newNumberVector device="CCD Simulator" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">3</oneNumber></newNumberVector>\n',
      () => propertyOf(cria, 'CCD Simulator', 'CCD_EXPOSURE')?.state === 'Busy',
    )
    const operation = await cria.run('primary', 'capture', { exposureSeconds: 1, light: true })

    expect(operation).toMatchObject({ kind: 'failed', state: 'settled' })
    expect(operation.message).toMatch(/not idle/)
  })

  it('runs one request ID once and refuses the same ID with different content', async () => {
    const requestId = crypto.randomUUID()
    const first = await cria.submit('focuser', 'focuser-move', { position: 50100}, requestId)
    const again = await cria.submit('focuser', 'focuser-move', { position: 50100}, requestId)
    const changed = await cria.submit('focuser', 'focuser-move', { position: 50200}, requestId)

    expect(again.body.id).toBe(first.body.id)
    expect(changed).toMatchObject({ status: 409, body: { error: { code: 'request-conflict' } } })
    expect((await cria.client.byRequest((await cria.client.health()).instanceId, requestId)).body).toMatchObject({ id: first.body.id })
    await cria.settled(first.body.id)
  })
})

describe('focuser', () => {
  it('moves to the target and reports the confirmed position', async () => {
    const operation = await cria.run('focuser', 'focuser-move', { position: 51234})

    expect(operation).toMatchObject({ kind: 'confirmed', values: { position: 51234 } })
  })

  it('refuses a target past the mechanical limit before sending anything', async () => {
    const position = await listen('Focuser Simulator', 'ABS_FOCUS_POSITION')

    try {
      const refused = await cria.run('focuser', 'focuser-move', { position: 100000})

      expect(refused).toMatchObject({ kind: 'failed', reason: 'invalid', message: 'Focuser target approaches the mechanical limit' })

        expect(await cria.run('focuser', 'focuser-move', { position: 50500})).toMatchObject({ kind: 'confirmed' })
      expect(position.updates[0]).toBe('Ok 50500')
    } finally {
      position.close()
    }
  })
})

describe('mount', () => {
  it('tracks, slews in its own frame (JNow), and refuses another frame before moving', async () => {
    expect(await cria.run('mount', 'mount-tracking', { tracking: true })).toMatchObject({ kind: 'confirmed' })

    const refused = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: 30, declinationDegrees: 20, coordinateSystem: 'j2000' })

    expect(refused).toMatchObject({ kind: 'failed', state: 'settled' })
    expect(refused.message).toMatch(/frame/)

    // Aim near where the mount points now, so the slew's length doesn't depend on the time of day.
    const ra = (Number(propertyOf(cria, 'Telescope Simulator', 'EQUATORIAL_EOD_COORD')!.elements.get('RA')!.value) * 15 + 10) % 360
    const slew = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: ra, declinationDegrees: 75, coordinateSystem: 'topocentric' })

    expect([slew.kind, slew.message]).toEqual(['confirmed', null])
    expect(Number(slew.values!.rightAscensionDegrees)).toBeCloseTo(ra, 0)
  })

  it('a cancelled slew stops the mount and ends cancelled', async () => {
    const submitted = await cria.submit('mount', 'mount-slew', { rightAscensionDegrees: 200, declinationDegrees: -30, coordinateSystem: 'topocentric' })

    await until('Cria to see the slew', () => propertyOf(cria, 'Telescope Simulator', 'EQUATORIAL_EOD_COORD')?.state === 'Busy')
    await cria.cancel(submitted.body.id)
    const operation = await cria.settled(submitted.body.id)

    expect(operation).toMatchObject({ kind: 'stopped', state: 'settled' })
    expect(propertyOf(cria, 'Telescope Simulator', 'EQUATORIAL_EOD_COORD')?.state).not.toBe('Busy')
  })
})
