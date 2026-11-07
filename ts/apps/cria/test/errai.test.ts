/**
 * The real rig's INDI definitions, replayed. `fixtures/errai-2026-10-15.xml`
 * is what indiserver on errai (libindi 2.2.5: indi_asi_ccd, indi_asi_focuser,
 * indi_lx200am5, indi_pegasus_ppba) sent a read-only client that asked
 * `getProperties` on 2026-10-15; the site latitude and longitude are zeroed.
 */
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDevices, startCria, type Cria } from './harness.js'

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

beforeAll(async () => {
  replay = new Replay()
  await replay.start()
  cria = await startCria(replay.port, deployConfig.devices)
  await connectDevices(cria, deployConfig.devices.map((device: { id: string }) => device.id))
})

afterAll(async () => {
  await cria?.stop()
  await replay?.stop()
})

describe('errai, replayed', () => {
  it('finds every configured device by its INDI name; sets up the 2600 (frames to Cria) and the AM5 (site, then time), and the 220MM needs nothing', () => {
    const written = replay.commands.map(xml => [
      /device="([^"]+)"/.exec(xml)![1],
      / name="([^"]+)"/.exec(xml)![1],
      [...xml.matchAll(/<one\w+ name="(\w+)">\s*([^<]*?)\s*</g)].map(([, element, value]) => `${element}=${value}`).join(' '),
    ])

    expect(written.toSorted()).toEqual([
      ['ZWO AM5', 'DEBUG', 'ENABLE=On'],
      ['ZWO AM5', 'GEOGRAPHIC_COORD', 'LAT=33.45 LONG=247.93 ELEV=331'],
      ['ZWO AM5', 'TIME_UTC', expect.stringMatching(/^UTC=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d OFFSET=0\.00$/)],
      ['ZWO CCD ASI2600MC Pro', 'UPLOAD_MODE', 'UPLOAD_CLIENT=On'],
    ])
  })

  const refused = async (device: string, kind: string, parameters: object) => {
    const before = replay.commands.length
    const operation = await cria.run(device, kind, parameters)

    expect(replay.commands.slice(before)).toEqual([])

    return [operation.kind, operation.reason, operation.message]
  }

  it('refuses a gain or offset outside the 2600MC Pro CCD_CONTROLS ranges (gain to 700, offset to 240), before sending', async () => {
    expect(await refused('primary', 'camera-configure', { gain: 701 })).toEqual(['failed', 'invalid', 'Invalid gain'])
    expect(await refused('primary', 'camera-configure', { offset: 241 })).toEqual(['failed', 'invalid', 'Invalid offset'])
  })

  it('refuses an exposure past each camera maximum (2000 s on the 2600MC Pro, 10 s on the 220MM Mini), before sending', async () => {
    expect(await refused('primary', 'capture', { exposureSeconds: 2001, light: true })).toEqual(['failed', 'invalid', 'Exposure 2001 s is outside 0.000032-2000 s'])
    expect(await refused('guide', 'capture', { exposureSeconds: 11, light: true })).toEqual(['failed', 'invalid', expect.stringMatching(/^Exposure 11 s is outside .*-10 s$/)])
  })

  it('refuses a slew in the wrong frame: the AM5 reports JNow, which Cria never converts', async () => {
    expect(await refused('mount', 'mount-slew', { rightAscensionDegrees: 10, declinationDegrees: 20, coordinateSystem: 'j2000' })).toEqual([
      'failed',
      'invalid',
      "Coordinates must be in the mount's frame (topocentric); Cria never converts frames",
    ])
  })

  it('refuses a move past the deploy config travel window (15500 to 38000), which is narrower than the EAF range, before sending', async () => {
    expect(await refused('focuser', 'focuser-move', { position: 38001 })).toEqual([
      'failed',
      'invalid',
      expect.stringMatching(/^Focuser target 38001 is outside the travel window 15500\.\.38000/),
    ])
    expect(await refused('focuser', 'focuser-move', { position: 15499 })).toEqual(['failed', 'invalid', expect.stringMatching(/outside the travel window 15500\.\.38000/)])
  })

  it('takes a gain inside the range and writes it to CCD_CONTROLS', async () => {
    expect(await cria.run('primary', 'camera-configure', { gain: 300 })).toMatchObject({ kind: 'confirmed', values: { gain: 300 } })
  })

  it('refuses a manual dew duty while the PPBA has auto dew on, before sending', async () => {
    const before = replay.commands.length
    const operation = await cria.run('box', 'switch-set', { channelId: 3, value: 20 })

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
      ['ZWO CCD ASI2600MC Pro', 'CCD_FRAME_TYPE', 'FRAME_LIGHT'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_FRAME_TYPE', 'FRAME_FLAT'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_FRAME_TYPE', 'FRAME_DARK'],
      ['ZWO CCD ASI2600MC Pro', 'CCD_FRAME_TYPE', 'FRAME_BIAS'],
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
