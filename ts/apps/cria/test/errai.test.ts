/**
 * The real rig's INDI definitions, replayed. `fixtures/errai-2026-10-15.xml`
 * is what indiserver on errai (libindi 2.2.5: indi_asi_ccd, indi_asi_focuser,
 * indi_lx200am5, indi_pegasus_ppba) sent a read-only client that asked
 * `getProperties` on 2026-10-15; the site latitude and longitude are zeroed.
 */
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allReady, noneNotRead, startCria, type Cria, type Device } from './harness.js'

const recording = readFileSync(new URL('./fixtures/errai-2026-10-15.xml', import.meta.url), 'utf8')
const deployConfig = JSON.parse(readFileSync(new URL('../../../deploy/rig.errai.json', import.meta.url), 'utf8'))

/** A driver's answer to a write that it applied as asked. */
const applied = (command: string) => `${command.replace(/^<new(\w+)Vector/, '<set$1Vector state="Ok"').replace(/<\/new(\w+)Vector>$/, '</set$1Vector>')}\n`

interface Definition {
  readonly device: string
  readonly name: string
  readonly xml: string
}

const definitions: Definition[] = [...recording.matchAll(/<def(\w+)Vector device="([^"]+)" name="([^"]+)"[\s\S]*?<\/def\1Vector>/g)].map(
  match => ({ device: match[2]!, name: match[3]!, xml: `${match[0]}\n` }),
)

class Replay {
  private server!: net.Server
  readonly commands: string[] = []
  port = 0

  async start() {
    this.server = net.createServer(socket => {
      let buffer = ''

      socket.on('error', () => undefined)
      socket.on('data', chunk => {
        buffer += chunk.toString()
        for (const element of buffer.match(/<(\w+)[^>]*\/>|<(\w+)[^>]*>[\s\S]*?<\/\2>/g) ?? []) {
          buffer = buffer.slice(buffer.indexOf(element) + element.length)
          const device = /device="([^"]+)"/.exec(element)?.[1]
          const name = / name="([^"]+)"/.exec(element.slice(0, element.indexOf('>')))?.[1]

          if (element.startsWith('<getProperties')) {
            for (const definition of definitions) {
              if ((!device || device === definition.device) && (!name || name === definition.name)) socket.write(definition.xml)
            }
          } else if (!element.startsWith('<pingReply')) {
            this.commands.push(element)
            if (element.startsWith('<new'))
              socket.write(applied(element))
          }
        }
      })
    })
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as net.AddressInfo).port
  }

  stop() {
    return new Promise<void>(resolve => this.server.close(() => resolve()))
  }
}

let replay: Replay
let cria: Cria
let devices: Record<string, Device>

beforeAll(async () => {
  replay = new Replay()
  await replay.start()
  cria = await startCria(replay.port, deployConfig.devices)
  await cria.waitFor(allReady(deployConfig.devices.map((device: { id: string }) => device.id)))
  const state = await cria.waitFor(noneNotRead)

  devices = Object.fromEntries(state.devices.map(device => [device.id, device]))
})

afterAll(async () => {
  await cria?.stop()
  await replay?.stop()
})

/** A fresh reading's value; otherwise its status, or the reason it is unavailable. */
const value = (device: string, field: string) => {
  const reading = (devices[device]!.readings as Record<string, Device['readings']['connected'] | undefined>)[field]

  if (reading?.status === 'fresh') return reading.value

  return reading?.status === 'unavailable' ? reading.reason : reading?.status
}

describe('errai, replayed', () => {
  it('finds every configured device by its INDI name; sets up the 2600 (frames to Cria) and the AM5 (site, then time), and the 220MM needs nothing', () => {
    const written = replay.commands.map(xml => [
      /device="([^"]+)"/.exec(xml)![1],
      / name="([^"]+)"/.exec(xml)![1],
      [...xml.matchAll(/<one\w+ name="(\w+)">\s*([^<]*?)\s*</g)].map(([, element, value]) => `${element}=${value}`).join(' '),
    ])

    expect(Object.values(devices).map(device => [device.id, device.availability])).toEqual(
      deployConfig.devices.map((device: { id: string }) => [device.id, { ready: true }]),
    )
    expect(written.toSorted()).toEqual([
      ['ZWO AM5', 'GEOGRAPHIC_COORD', 'LAT=40 LONG=285 ELEV=0'],
      ['ZWO AM5', 'TIME_UTC', expect.stringMatching(/^UTC=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d OFFSET=0\.00$/)],
      ['ZWO CCD ASI2600MC Pro', 'UPLOAD_MODE', 'UPLOAD_CLIENT=On'],
    ])
  })

  it('reads the ASI2600MC Pro: geometry, RGGB colour, CCD_CONTROLS gain and offset, cooler', () => {
    expect(value('primary', 'width')).toBe(6248)
    expect(value('primary', 'height')).toBe(4176)
    expect(value('primary', 'pixelWidthMicrons')).toBeCloseTo(3.76, 2)
    expect(value('primary', 'bayerPattern')).toBe('rggb')
    expect([value('primary', 'gain'), value('primary', 'gainMinimum'), value('primary', 'gainMaximum')]).toEqual([200, -25, 700])
    expect([value('primary', 'offset'), value('primary', 'offsetMaximum')]).toEqual([1, 240])
    expect([value('primary', 'exposureMinimum'), value('primary', 'exposureMaximum')]).toEqual([0.000032, 2000])
    expect(value('primary', 'temperatureC')).toBe(23.8)
    expect(value('primary', 'coolerOn')).toBe(false)
    expect(value('primary', 'canSetTemperature')).toBe(true)
    expect(value('primary', 'coolerPowerPercent')).toBe(0)
    expect(value('primary', 'setpointC')).toBe('unsupported')
    expect(devices.primary).toMatchObject({ lastCommandedSetpointC: null })
  })

  it('reads the ASI220MM Mini as an uncooled mono camera', () => {
    expect([value('guide', 'width'), value('guide', 'height'), value('guide', 'bayerPattern')]).toEqual([1920, 1080, 'mono'])
    expect(value('guide', 'canSetTemperature')).toBe(false)
    expect(value('guide', 'canGetCoolerPower')).toBe(false)
    expect(value('guide', 'exposureMaximum')).toBe(10)
    expect(value('guide', 'gain')).toBe(100)
  })

  it('reads the AM5: JNow coordinates, tracking, park, home, named slew rates; no pier side yet', () => {
    expect(value('mount', 'coordinateSystem')).toBe('topocentric')
    expect(value('mount', 'declinationDegrees')).toBe(90)
    expect([value('mount', 'tracking'), value('mount', 'parked'), value('mount', 'slewing')]).toEqual([false, false, false])
    expect(value('mount', 'trackingRate')).toBe('sidereal')
    expect(value('mount', 'canFindHome')).toBe(true)
    expect(value('mount', 'canMovePrimaryAxis')).toBe(true)
    expect((value('mount', 'primaryAxisRates') as Array<{ degreesPerSecond: number }>).map(rate => rate.degreesPerSecond * 3600 / 15.041067)).toEqual(
      [0.25, 0.5, 1, 2, 4, 8, 20, 60, 720, 1440].map(multiple => expect.closeTo(multiple, 6)),
    )
    // Both TELESCOPE_PIER_SIDE switches are Off on the AM5 (at least at the pole): reported as unknown.
    expect(value('mount', 'pierSide')).toBe('unknown')
    expect(value('mount', 'rightAscensionRateSecondsPerSiderealSecond')).toBe('unsupported')
  })

  it('reads the EAF: position, travel, temperature', () => {
    expect(value('focuser', 'position')).toBe(32749)
    expect(value('focuser', 'temperatureC')).toBe(24)
    // FOCUS_MAX says 100000 and ABS_FOCUS_POSITION allows 0 to 60000; the deploy config's travel window (15500 to 38000) is narrower than both.
    expect([value('focuser', 'minStep'), value('focuser', 'maxStep')]).toEqual([15500, 38000])
  })

  it('reads the PPB Micro: weather, the 12 V master and the dew channels', () => {
    expect([value('weather', 'temperatureC'), value('weather', 'humidityPercent'), value('weather', 'dewPointC')]).toEqual([21.6, 53, 11.6])
    expect(value('weather', 'pressureHpa')).toBe('unsupported')

    const powerBox = devices.switch!
    const fresh = <T>(reading: { status: string; value?: T }) => (reading.status === 'fresh' ? reading.value : reading.status)
    const channels = powerBox.kind === 'switch' ? powerBox.channels.map(channel => [fresh(channel.name), fresh(channel.value), fresh(channel.writable)]) : []

    expect(channels).toEqual([
      ['12V ports', 1, true],
      ['Dew A', 1, true],
      ['Dew B', 1, true],
      ['Dew A duty (%)', 0, true],
      ['Dew B duty (%)', 0, true],
      ['Auto dew', 1, true],
    ])
  })

  it.each([
    [{ width: 3121 }, 'width 3121 binned pixels; the camera needs a multiple of 8 binned pixels; nearest 3120 or 3128'],
    [{ height: 2087 }, 'height 2087 binned pixels; the camera needs a multiple of 2 binned pixels; nearest 2086 or 2088'],
  ])('refuses a 2600 region %o off the grid before sending: the driver defines no step, the deploy config does', async (region, message) => {
    const before = replay.commands.length
    const operation = await cria.run('primary', 'camera-configure', region)

    expect([operation.kind, operation.reason, operation.message]).toEqual(['failed', 'invalid', message])
    expect(replay.commands.slice(before)).toEqual([])
  })

  it('refuses a manual dew duty while the PPBA has auto dew on, before sending', async () => {
    const before = replay.commands.length
    const operation = await cria.run('switch', 'switch-set', { channelId: 3, value: 20 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'Dew A duty (%) is set automatically while Auto dew is on; switch Auto dew (channel 5) off first',
    ])
    expect(replay.commands.slice(before)).toEqual([])
  })

  it('defines every property and element the commands write', () => {
    const has = (device: string, property: string, element: string) =>
      definitions.some(definition => definition.device === device && definition.name === property && definition.xml.includes(`name="${element}"`))
    // TODO: derive this from what the commands send; that needs a recording run per kind on errai's names, which the fake does not define.
    const written: Array<[string, string, string]> = [
      ['ZWO CCD ASI2600MC Pro', 'CCD_EXPOSURE', 'CCD_EXPOSURE_VALUE'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_ABORT_EXPOSURE', 'ABORT'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_FRAME_TYPE', 'FRAME_DARK'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_BINNING', 'HOR_BIN'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_FRAME', 'WIDTH'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_CONTROLS', 'Gain'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_CONTROLS', 'Offset'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_TEMPERATURE', 'CCD_TEMPERATURE_VALUE'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_COOLER', 'COOLER_ON'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_COOLER', 'COOLER_OFF'],
      ['ZWO CCD ASI2600MC Pro', 'UPLOAD_MODE', 'UPLOAD_CLIENT'],
      ['ZWO CCD ASI220MM Mini', 'CCD_EXPOSURE', 'CCD_EXPOSURE_VALUE'],
      ['ZWO CCD ASI220MM Mini', 'CCD_ABORT_EXPOSURE', 'ABORT'],
      ['ZWO EAF', 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION'],
      ['ZWO EAF', 'FOCUS_ABORT_MOTION', 'ABORT'],
      ['ZWO AM5', 'EQUATORIAL_EOD_COORD', 'RA'],
      ['ZWO AM5', 'ON_COORD_SET', 'TRACK'],
      ['ZWO AM5', 'TELESCOPE_ABORT_MOTION', 'ABORT'],
      ['ZWO AM5', 'TELESCOPE_TRACK_STATE', 'TRACK_ON'],
      ['ZWO AM5', 'TELESCOPE_PARK', 'PARK'],
      ['ZWO AM5', 'TELESCOPE_PARK', 'UNPARK'],
      ['ZWO AM5', 'TELESCOPE_HOME', 'GO'],
      ['ZWO AM5', 'TELESCOPE_MOTION_WE', 'MOTION_EAST'],
      ['ZWO AM5', 'TELESCOPE_MOTION_WE', 'MOTION_WEST'],
      ['ZWO AM5', 'TELESCOPE_SLEW_RATE', '1x'],
      ['ZWO AM5', 'GEOGRAPHIC_COORD', 'LAT'],
      ['ZWO AM5', 'GEOGRAPHIC_COORD', 'LONG'],
      ['ZWO AM5', 'GEOGRAPHIC_COORD', 'ELEV'],
      ['ZWO AM5', 'TIME_UTC', 'UTC'],
      ['ZWO AM5', 'TIME_UTC', 'OFFSET'],
      ['Pegasus PPBA', 'POWER_CHANNELS', 'POWER_CHANNEL_1'],
      ['Pegasus PPBA', 'DEW_DUTY_CYCLES', 'DEW_CHANNEL_1'],
      ...['ZWO CCD ASI2600MC Pro', 'ZWO CCD ASI220MM Mini', 'ZWO EAF', 'ZWO AM5', 'Pegasus PPBA'].map(
        device => [device, 'CONNECTION', 'CONNECT'] as [string, string, string],
      ),
      ['ZWO AM5', 'DEVICE_PORT', 'PORT'],
      ['Pegasus PPBA', 'DEVICE_PORT', 'PORT'],
    ]

    expect(written.filter(([device, property, element]) => !has(device, property, element))).toEqual([])
  })
})
