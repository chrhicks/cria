/**
 * indi-replay against the real Cria. A night is recorded from the INDI
 * simulators (a camera and a mount, six captures with the mount slewed between
 * them), then the real Cria runs against the recording served by indi-replay.
 * Simulators, files and a fake of indiserver only: no equipment.
 *
 * The simulated mount takes its time from the machine clock and its idea of
 * the meridian from its site. A goto across the meridian is a pier flip over
 * the pole (30 s, past Cria's 20 s operation timeout), and where the mount
 * starts depends on the time of day. So the night is aimed by hour angle, not
 * by the right ascension the mount happens to start at.
 *
 * REPLAY_LIVENESS_SECONDS sets how long the liveness test keeps Cria running
 * (default 15; 600 is the ten-minute check).
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { localSiderealHours as criaSiderealHours } from '../apps/cria/src/capability/mount.js'
import { allReady, startCria, until, valueOf, type Cria, type DeviceSpec } from '../apps/cria/test/harness.js'
import { localSiderealHours, loadTape, startReplay, type Replay } from '../packages/indi-replay/src/index.js'
import { readRecording, verifyRecording } from '../packages/recording/src/index.js'
import { startIndiServer } from './indiserver.js'

const root = join(import.meta.dirname, '..')
// A made-up site. Without one the simulated mount keeps sidereal time by a site of its own, which Cria's mount reading (longitude 0) does not share.
const site = { latitudeDegrees: 40, longitudeDegrees: -100, elevationMeters: 0 }
const devices: ReadonlyArray<DeviceSpec> = [
  { id: 'primary', kind: 'camera', indiDevice: 'CCD Simulator', connect: true },
  { id: 'mount', kind: 'mount', indiDevice: 'Telescope Simulator', connect: true, site },
]
const watching = devices.map(({ site: _site, ...device }) => ({ ...device, connect: false }))
const captures = 6
const exposureSeconds = 0.5
const frameStepDegrees = 5

/**
 * The hour angle (degrees, west positive) to slew to for each capture. Every one
 * is 30° to 150° west of the meridian, where the mount starts, so no slew
 * crosses the meridian; each is five degrees from the last, more than the
 * seconds between frames move it. The first is the start itself when that is
 * in range, else the nearest end of the range, so it is never a long way round.
 */
function hourAngleSchedule(startDegrees: number, count: number): number[] {
  const first = Math.min(150, Math.max(30, startDegrees))
  const step = first < 90 ? frameStepDegrees : -frameStepDegrees

  return Array.from({ length: count }, (_, capture) => first + step * capture)
}

let scratch: string
let folder: string
/** The ImageBytes digest of each capture Cria confirmed while recording, in order. */
let recordedDigests: string[]

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cria-replay-'))
  const indi = await startIndiServer(['indi_simulator_ccd', 'indi_simulator_telescope'])
  const cria = await startCria(indi.port, devices, { record: { dir: scratch, reserveGb: 0, queueMb: 256 } })

  try {
    await cria.waitFor(allReady(['primary', 'mount']))
    await cria.run('mount', 'mount-tracking', { tracking: true })

    const hourAngle = async () => {
      const mount = await cria.device('mount')

      return (Number(valueOf(mount, 'siderealTimeHours')) - Number(valueOf(mount, 'rightAscensionHours'))) * 15
    }
    const schedule = hourAngleSchedule(((await hourAngle()) + 540) % 360 - 180, captures)

    for (let capture = 0; capture < captures; capture++) {
      const mount = await cria.device('mount')
      const ra = (((Number(valueOf(mount, 'siderealTimeHours')) * 15 - schedule[capture]!) % 360) + 360) % 360
      const slew = await cria.run('mount', 'mount-slew', { rightAscensionDegrees: ra, declinationDegrees: 20, coordinateSystem: 'topocentric' })

      expect([slew.kind, slew.reason, slew.message]).toEqual(['confirmed', null, null])
      expect((await cria.run('primary', 'capture', { exposureSeconds, light: true })).kind).toBe('confirmed')
    }
  } finally {
    await cria.stop()
    await indi.stop()
  }

  folder = join(scratch, (await readdir(scratch))[0]!)
  recordedDigests = []
  for await (const line of readRecording(folder)) {
    const operation = line.k === 'op' ? line.operation : undefined

    if (operation?.kind === 'capture' && (operation.outcome as { kind?: string }).kind === 'confirmed')
      recordedDigests.push((operation.outcome as { value: { image: { sha256: string } } }).value.image.sha256)
  }
}, 120_000)

afterAll(() => rm(scratch, { recursive: true, force: true }))

let replay: Replay | undefined
let cria: Cria | undefined

afterEach(async () => {
  await cria?.stop()
  await replay?.stop()
  cria = undefined
  replay = undefined
})

async function run(options: { faults?: Parameters<typeof startReplay>[1] extends infer O ? (O extends { faults?: infer F } ? F : never) : never } = {}) {
  replay = await startReplay(await loadTape(folder), options)
  cria = await startCria(replay.port, watching)
  await cria.waitFor(allReady(['primary', 'mount']))

  return { replay, cria }
}

describe('the recording the simulators made', () => {
  it('is sound and holds six captures', async () => {
    expect(await verifyRecording(folder)).toMatchObject({ valid: true, ended: true, images: captures })
    expect(recordedDigests).toHaveLength(captures)
  })
})

describe('the night the simulators are aimed through', () => {
  it('stays 30° to 150° west of the meridian, in five degree steps, from any starting hour angle', () => {
    for (let start = -180; start <= 180; start += 0.5) {
      const schedule = hourAngleSchedule(start, captures)

      expect(schedule.every(angle => angle >= 30 && angle <= 150), `from ${start}°: ${schedule}`).toBe(true)
      expect(schedule.slice(1).map((angle, index) => Math.abs(angle - schedule[index]!)), `from ${start}°`).toEqual(Array(captures - 1).fill(frameStepDegrees))
    }
  })

  it('starts within 30° of a mount that starts west of the meridian', () => {
    for (let start = 0; start <= 180; start += 0.5) expect(Math.abs(hourAngleSchedule(start, 1)[0]! - start), `from ${start}°`).toBeLessThanOrEqual(30)
  })
})

describe('the real Cria on the replay', () => {
  it('confirms every capture, and each ImageBytes digest is the one recorded for it', async () => {
    const { cria } = await run()
    const digests: string[] = []

    for (let capture = 0; capture < captures; capture++) {
      const ending = await cria.run('primary', 'capture', { exposureSeconds, light: true })

      expect([ending.kind, ending.message]).toEqual(['confirmed', null])
      digests.push(ending.image!.sha256)
    }

    expect(digests).toEqual(recordedDigests)
  })

  it('shows the hour angle the recording had at each frame', async () => {
    const { cria, replay } = await run()
    const tape = await loadTape(folder)
    // The replay serves the latest longitude the recording held, as Cria reads it.
    const longitude = tape.events.flatMap(event => {
      if (event.kind === 'define') return event.vector.name === 'GEOGRAPHIC_COORD' ? [Number(event.vector.elements.LONG!.value)] : []

      return event.kind === 'update' && event.name === 'GEOGRAPHIC_COORD' && event.values.LONG !== undefined ? [Number(event.values.LONG)] : []
    }).at(-1)!
    const recordedRa = (t: number) => {
      const updates = tape.events.filter(event => event.kind === 'update' && event.name === 'EQUATORIAL_EOD_COORD' && event.values.RA !== undefined && event.t <= t)

      return Number((updates.at(-1) as { values: { RA: string } }).values.RA)
    }

    for (let capture = 0; capture < captures; capture++) {
      expect((await cria.run('primary', 'capture', { exposureSeconds, light: true })).kind).toBe('confirmed')
      const mount = await cria.device('mount')
      const frame = tape.frames[capture]!
      const expected = criaSiderealHours(frame.at, longitude) - recordedRa(frame.t)

      expect(Number(valueOf(mount, 'siderealTimeHours')) - Number(valueOf(mount, 'rightAscensionHours'))).toBeCloseTo(expected, 6)
      expect(replay.cursor()).toBe(capture + 1)
    }
  })

  it('computes sidereal time the way Cria does', () => {
    for (const [epoch, longitude] of [[Date.UTC(2026, 9, 18, 22), -75], [Date.UTC(2026, 0, 1), 10], [Date.UTC(2030, 5, 30, 3, 14, 15), 179.9]] as const)
      expect(localSiderealHours(epoch, longitude)).toBeCloseTo(criaSiderealHours(epoch, longitude), 12)
  })

  it('sends no late image after an abort, and the aborted frame stays used', async () => {
    const { cria, replay } = await run()
    const submitted = await cria.submit('primary', 'capture', { exposureSeconds: 2, light: true })

    if (!submitted.ok) throw new Error(JSON.stringify(submitted.body))
    await cria.waitFor(state => state.devices.find(device => device.id === 'primary')!.readings.activity?.value === 'exposing')
    expect((await cria.cancel(submitted.body.id)).ok).toBe(true)
    expect((await cria.settled(submitted.body.id)).kind).toBe('stopped')
    await new Promise(resolve => setTimeout(resolve, 2500))

    expect(replay.events().map(event => event.kind)).toEqual(['reserved', 'aborted'])
    expect(replay.cursor()).toBe(1)

    const next = await cria.run('primary', 'capture', { exposureSeconds, light: true })

    expect(next.image!.sha256).toBe(recordedDigests[1])
  })

  it('fails one exposure past the end cleanly: Alert "end of recording", no quarantine, still usable', async () => {
    const { cria } = await run()

    for (let capture = 0; capture < captures; capture++) expect((await cria.run('primary', 'capture', { exposureSeconds, light: true })).kind).toBe('confirmed')

    const past = await cria.run('primary', 'capture', { exposureSeconds, light: true })

    expect([past.kind, past.reason, past.message, past.quarantined]).toEqual(['failed', 'rejected', 'end of recording', false])
    expect((await cria.device('primary')).quarantine.held).toBe(false)
    await cria.waitFor(allReady(['primary', 'mount']))
  })

  it('keeps every device fresh for as long as it runs (REPLAY_LIVENESS_SECONDS)', async () => {
    const { cria } = await run()
    const seconds = Number(process.env.REPLAY_LIVENESS_SECONDS ?? 15)
    const deadline = Date.now() + seconds * 1000
    let looks = 0

    while (Date.now() < deadline) {
      const state = await cria.state()

      for (const device of state.devices) {
        expect([device.id, device.availability.ready]).toEqual([device.id, true])
        expect([device.id, JSON.stringify(device.readings).includes('"status":"stale"')]).toEqual([device.id, false])
      }
      looks += 1
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log(`liveness: ${looks} looks over ${seconds} s, every device ready and no reading stale each time`)
    expect(looks).toBeGreaterThanOrEqual(Math.floor(seconds * 0.8))
  }, Number(process.env.REPLAY_LIVENESS_SECONDS ?? 15) * 1000 + 60_000)
})

describe('the indi-replay program', () => {
  it('serves a recording on a port it prints, and stops on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--conditions=@cria/source', '--import', join(root, 'testing', 'source-hook.mjs'), join(root, 'packages', 'indi-replay', 'src', 'main.ts'), 'serve', folder], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))

    child.stdout.on('data', chunk => void (out += String(chunk)))
    child.stderr.on('data', () => undefined)

    const port = Number(await until('the program to print its port', () => /listening on 127\.0\.0\.1:(\d+)/.exec(out)?.[1]))

    cria = await startCria(port, watching)
    await cria.waitFor(allReady(['primary', 'mount']))
    expect((await cria.run('primary', 'capture', { exposureSeconds, light: true })).image!.sha256).toBe(recordedDigests[0])

    child.kill('SIGTERM')
    expect(await exited).toBe(0)
  })
})
