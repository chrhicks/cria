import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Option, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeIndiClient } from '@cria/indi'
import { startReplay, type Replay } from './replay.js'
import { tapeFromStream } from './synthesize.js'
import { loadTape } from './tape.js'

/**
 * Some INDI drivers define properties with no device and no name. The Pegasus PPBA and ZWO AM5 drivers did it
 * on the first real night recorded on the rig: five definitions of four kinds with every attribute empty, in the
 * middle of the drivers' real ones, and once more each time a driver answered a getProperties. indiserver relays
 * them, Cria reads them and goes on, and the recorder keeps them like everything else.
 *
 * Replay holds one property per device and name, so all of them are one property, and every definition after the
 * first was treated as a refresh of it. Cria's `refresh` wrote a number's `0` into the light's element, the light
 * went out as `<defLight name="">0</defLight>`, and Cria's parser (rightly) threw on a light that is not Idle, Ok,
 * Busy or Alert. Cria closes a connection it cannot parse, so it read the first devices' definitions, lost the
 * connection, reconnected, and never read the others: every device `unavailable`.
 *
 * The definitions below have the shapes of the real ones, with invented text.
 */
const camera = 'Test Camera'
const stamp = 'timestamp="2030-01-01T00:00:00"'

const connection = (device: string) =>
  `<defSwitchVector device="${device}" name="CONNECTION" label="Connection" group="Main Control" state="Ok" perm="rw" rule="OneOfMany" timeout="60" ${stamp}><defSwitch name="CONNECT" label="Connect">On</defSwitch><defSwitch name="DISCONNECT" label="Disconnect">Off</defSwitch></defSwitchVector>`

/** What the drivers sent with no device and no name, in the order they sent it. */
const emptyDefinitions = [
  `<defLightVector device="" name="" label="" group="" state="Ok" ${stamp}><defLight name="" label="">Ok</defLight></defLightVector>`,
  `<defSwitchVector device="" name="" label="" group="" state="Idle" perm="ro" rule="OneOfMany" timeout="0" ${stamp}/>`,
  `<defNumberVector device="" name="" label="" group="" state="Idle" perm="ro" timeout="0" ${stamp}/>`,
  `<defTextVector device="" name="" label="" group="" state="Idle" perm="ro" timeout="0" ${stamp}/>`,
  `<defNumberVector device="" name="" label="" group="" state="Idle" perm="ro" timeout="0" ${stamp}><defNumber name="" label="" format="" min="0" max="0" step="0">0</defNumber><defNumber name="" label="" format="" min="0" max="0" step="0">0</defNumber></defNumberVector>`,
]

const power = 'Test Power'
const mount = 'Test Mount'
const weatherStatus = `<defLightVector device="${power}" name="WEATHER_STATUS" label="Status" group="Environment" state="Ok" ${stamp}><defLight name="TEMPERATURE" label="Temperature">Ok</defLight></defLightVector>`
const trackState = `<defSwitchVector device="${mount}" name="TELESCOPE_TRACK_STATE" label="Tracking" group="Main Control" state="Idle" perm="rw" rule="OneOfMany" timeout="0" ${stamp}><defSwitch name="TRACK_ON" label="On">Off</defSwitch><defSwitch name="TRACK_OFF" label="Off">On</defSwitch></defSwitchVector>`
const image = `<setBLOBVector device="${camera}" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="1" format=".fits"/></setBLOBVector>`

const stream: ReadonlyArray<readonly ['in' | 'out', string]> = [
  ['out', '<getProperties version="1.7"/>'],
  ['in', connection(power)],
  ['in', weatherStatus],
  // Two of the empty ones between the power device's own, one more among the mount's, as the real drivers did.
  ['in', emptyDefinitions[0]!],
  ['in', emptyDefinitions[1]!],
  ['in', emptyDefinitions[2]!],
  ['in', connection(mount)],
  ['in', emptyDefinitions[3]!],
  ['in', trackState],
  ['in', emptyDefinitions[4]!],
  ['in', connection(camera)],
  ['in', `<defNumberVector device="${camera}" name="CCD_EXPOSURE" label="" group="Main" state="Idle" perm="rw" timeout="60"><defNumber name="CCD_EXPOSURE_VALUE" label="Duration" format="%g" min="0" max="3600" step="1">0</defNumber></defNumberVector>`],
  ['in', `<defBLOBVector device="${camera}" name="CCD1" label="" group="Main" state="Idle" perm="ro" timeout="60"><defBLOB name="CCD1" label="Image"/></defBLOBVector>`],
  ['in', `<setNumberVector device="${camera}" name="CCD_EXPOSURE" state="Busy"><oneNumber name="CCD_EXPOSURE_VALUE">0.05</oneNumber></setNumberVector>`],
  ['in', image],
  ['in', `<setNumberVector device="${camera}" name="CCD_EXPOSURE" state="Ok"><oneNumber name="CCD_EXPOSURE_VALUE">0</oneNumber></setNumberVector>`],
]

let directory: string
let replay: Replay | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'indi-replay-empty-'))
})

afterEach(async () => {
  await replay?.stop()
  replay = undefined
  await rm(directory, { recursive: true, force: true })
})

describe('definitions with no device and no name in a recording', () => {
  it('are served as definitions Cria can read, and Cria keeps its connection and reads every device', async () => {
    const folder = await tapeFromStream(stream, { devices: [{ id: 'primary', kind: 'camera', indiDevice: camera }], sensor: { width: 16, height: 8 }, startAt: Date.UTC(2030, 0, 1) }, join(directory, 'tape'))

    replay = await startReplay(await loadTape(folder))

    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeIndiClient({ host: '127.0.0.1', port: replay!.port })
          const connections: string[] = []

          yield* Effect.forkScoped(
            Stream.runForEach(client.device(mount).events, event =>
              Effect.sync(() => {
                if (event.type === 'connection') connections.push(event.status.kind)
              }),
            ),
          )

          // The last thing the camera defines comes after every empty definition, so a lost connection shows as its absence.
          for (let waited = 0; Option.isNone(yield* client.device(camera).property('CCD1')); waited += 10) {
            if (waited > 5000) throw new Error(`Cria never read the camera's definitions; the connection went ${connections.join(', ')}`)
            yield* Effect.sleep('10 millis')
          }

          return {
            connections,
            status: (yield* client.status).kind,
            power: Option.isSome(yield* client.device(power).property('WEATHER_STATUS')),
            mount: Option.isSome(yield* client.device(mount).property('TELESCOPE_TRACK_STATE')),
          }
        }),
      ),
    )

    expect(seen).toEqual({ connections: ['connected'], status: 'connected', power: true, mount: true })
  })

  it('are all served, as the drivers sent them, each kind as its own kind', async () => {
    const folder = await tapeFromStream(stream, { devices: [{ id: 'primary', kind: 'camera', indiDevice: camera }], sensor: { width: 16, height: 8 }, startAt: Date.UTC(2030, 0, 1) }, join(directory, 'tape'))

    replay = await startReplay(await loadTape(folder))

    const socket = net.connect(replay.port, '127.0.0.1')
    let text = ''

    socket.on('data', chunk => void (text += chunk.toString('utf8')))
    await new Promise<void>(resolve => socket.once('connect', () => resolve()))
    socket.write('<getProperties version="1.7"/>\n<pingRequest uid="done"/>\n')
    for (let waited = 0; !text.includes('<pingReply uid="done"/>'); waited += 5) {
      if (waited > 5000) throw new Error('no ping reply')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    socket.destroy()

    for (const tag of text.match(/<def(Light|Switch|Number|Text)Vector\b[^>]*>/g) ?? []) {
      if (tag.includes('device=""')) expect(tag).toMatch(/name=""/)
    }
    // A light says Idle, Ok, Busy or Alert, whatever else the store holds under the same name.
    for (const light of text.matchAll(/<defLight\b[^>]*>([^<]*)<\/defLight>/g)) expect(light[1]!.trim()).toMatch(/^(Idle|Ok|Busy|Alert)$/)
  })
})
