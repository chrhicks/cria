/**
 * A recording made up, in the real format, with tiny frames and a fake site.
 * Committed scenarios use these and never a real night, so no real coordinates
 * enter a public repository. The definitions come from `@cria/fake-indi`'s
 * camera and mount, written as the lines Cria's recorder would have written.
 * A synthetic tape holds no `op` lines: no Cria ran.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { FakeIndi, addCamera, addMount, connection } from '@cria/fake-indi'
import { fitsFrame } from '@cria/fits'
import type { Manifest, RecordingLine } from '@cria/recording'

export interface SynthSpec {
  /** INDI device names. Defaults `Synthetic Camera` and `Synthetic Mount`. */
  readonly camera?: string
  readonly mount?: string
  /** Adds a focuser with this INDI name, so a replay can refuse its moves. None by default. */
  readonly focuser?: string
  /** Big enough for the stars: a star is 3x3 pixels. */
  readonly sensor: { readonly width: number; readonly height: number }
  readonly exposureSeconds: number
  /** One entry per frame: how many stars it shows (the first that many of a fixed field). A snag is `[12, 12, 12, 0, 0]`. */
  readonly stars: ReadonlyArray<number>
  /** A made-up site, longitude east positive. */
  readonly site: { readonly latitudeDegrees: number; readonly longitudeDegrees: number }
  /** Epoch milliseconds the recording starts. */
  readonly startAt: number
  /** Where the mount points while it tracks. */
  readonly pointing: { readonly raHours: number; readonly decDegrees: number }
  /** The frames the mount tracks for: from `from` to before `until` (null: to the end). Default: all. Off, its RA drifts at the sidereal rate. */
  readonly tracking?: { readonly from: number; readonly until: number | null }
  /** Seconds between one frame's end and the next exposure's start. Default 2. */
  readonly gapSeconds?: number
}

const siderealDegreesPerSecond = 15.041067 / 3600
const firstExposureMs = 1000

function rng(seed: number) {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 2 ** 32
  }
}

/** A fits frame of noise around 1000, with `stars` bright 3x3 stars at fixed places. */
function render(spec: SynthSpec, index: number, startedAt: number): Buffer {
  const { width, height } = spec.sensor
  const frame = fitsFrame(width, height, { exptime: spec.exposureSeconds, startedAt })
  const noise = rng(1000 + index)
  const place = rng(7)
  const pixels = new Int32Array(width * height)

  for (let at = 0; at < pixels.length; at++) pixels[at] = 1000 + Math.floor(noise() * 20)
  for (let star = 0; star < spec.stars[index]!; star++) {
    const x = 1 + Math.floor(place() * (width - 2))
    const y = 1 + Math.floor(place() * (height - 2))

    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) pixels[(y + dy) * width + x + dx] = (dx === 0 && dy === 0 ? 40000 : 15000)
  }

  pixels.forEach((value, at) => frame.writeInt16BE(value - 32768, 2880 + at * 2))

  return frame
}

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** Writes the recording to `into` (created if needed) and returns it. */
export async function synthesizeTape(spec: SynthSpec, into: string): Promise<string> {
  const folder = resolve(into)
  const camera = spec.camera ?? 'Synthetic Camera'
  const mount = spec.mount ?? 'Synthetic Mount'
  const gapMs = (spec.gapSeconds ?? 2) * 1000
  const tracking = spec.tracking ?? { from: 0, until: null }
  const tracks = (frame: number) => frame >= tracking.from && (tracking.until === null || frame < tracking.until)
  const lines: RecordingLine[] = []
  const counts = new Map<string, number>()
  const blobs: Array<[string, Buffer]> = []
  let t = 0

  const stamp = (milliseconds: number) => {
    t = Math.max(t, milliseconds)

    return { t, at: spec.startAt + t }
  }

  const message = (dir: 'in' | 'out', xml: string, at: number, image?: Buffer) => {
    const n = counts.get(dir) ?? 0
    const path = `blobs/1-${n}-0.blob`

    counts.set(dir, n + 1)
    if (image) blobs.push([path, image])
    lines.push({
      k: 'msg',
      ...stamp(at),
      conn: 1,
      dir,
      n,
      xml: image ? xml.replace('/>', ` ref="${path}"/>`) : xml,
      ...(image ? { blobs: [path] } : {}),
    })
  }

  const fake = new FakeIndi()

  addCamera(fake, camera, spec.sensor)
  addMount(fake, mount)
  if (spec.focuser !== undefined) {
    fake.define(connection(spec.focuser))
    fake.define({ device: spec.focuser, name: 'ABS_FOCUS_POSITION', kind: 'number', perm: 'rw', state: 'Ok', elements: { FOCUS_ABSOLUTE_POSITION: { value: 5000, min: 0, max: 10000, step: 1 } } })
    fake.define({ device: spec.focuser, name: 'FOCUS_ABORT_MOTION', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })
  }
  const position = fake.vector(mount, 'EQUATORIAL_EOD_COORD').elements
  const site = fake.vector(mount, 'GEOGRAPHIC_COORD').elements
  const trackState = fake.vector(mount, 'TELESCOPE_TRACK_STATE').elements

  position.RA!.value = spec.pointing.raHours
  position.DEC!.value = spec.pointing.decDegrees
  site.LAT!.value = spec.site.latitudeDegrees
  site.LONG!.value = (spec.site.longitudeDegrees + 360) % 360
  trackState.TRACK_ON!.value = tracks(0)
  trackState.TRACK_OFF!.value = !tracks(0)

  lines.push({ k: 'conn', ...stamp(0), conn: 1, status: 'connected' })
  message('out', '<getProperties version="1.7"/>', 1)
  for (const vector of fake.vectors.values()) message('in', fake.definition(vector).trim(), t)

  let stoppedAt: { frame: number; ra: number } | undefined

  for (let frame = 0; frame < spec.stars.length; frame++) {
    const startMs = firstExposureMs + frame * (spec.exposureSeconds * 1000 + gapMs)
    const arrivesMs = startMs + spec.exposureSeconds * 1000 + 100
    const startedAt = spec.startAt + startMs
    const wasTracking = frame === 0 ? tracks(0) : tracks(frame - 1)

    if (frame > 0 && wasTracking !== tracks(frame)) {
      const on = tracks(frame)

      message('in', `<setSwitchVector device="${attribute(mount)}" name="TELESCOPE_TRACK_STATE" state="Ok"><oneSwitch name="TRACK_ON">${on ? 'On' : 'Off'}</oneSwitch><oneSwitch name="TRACK_OFF">${on ? 'Off' : 'On'}</oneSwitch></setSwitchVector>`, startMs - 20)
      if (!on) stoppedAt = { frame, ra: spec.pointing.raHours }
    }

    const ra = tracks(frame)
      ? spec.pointing.raHours
      : (stoppedAt?.ra ?? spec.pointing.raHours) + ((startMs - (firstExposureMs + (stoppedAt?.frame ?? 0) * (spec.exposureSeconds * 1000 + gapMs))) / 1000) * (siderealDegreesPerSecond / 15)

    message('in', `<setNumberVector device="${attribute(mount)}" name="EQUATORIAL_EOD_COORD" state="Ok"><oneNumber name="RA">${ra % 24}</oneNumber><oneNumber name="DEC">${spec.pointing.decDegrees}</oneNumber></setNumberVector>`, startMs - 10)
    message('out', `<newNumberVector device="${attribute(camera)}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">${spec.exposureSeconds}</oneNumber></newNumberVector>`, startMs - 5)
    message('in', `<setNumberVector device="${attribute(camera)}" name="CCD_EXPOSURE" state="Busy"><oneNumber name="CCD_EXPOSURE_VALUE">${spec.exposureSeconds}</oneNumber></setNumberVector>`, startMs)

    const image = render(spec, frame, startedAt)

    message('in', `<setBLOBVector device="${attribute(camera)}" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="${image.length}" format=".fits"/></setBLOBVector>`, arrivesMs, image)
    message('in', `<setNumberVector device="${attribute(camera)}" name="CCD_EXPOSURE" state="Ok"><oneNumber name="CCD_EXPOSURE_VALUE">0</oneNumber></setNumberVector>`, arrivesMs + 1)
  }

  lines.push({ k: 'end', ...stamp(t + 1) })

  const manifest: Manifest = {
    format: 1,
    recording: basename(folder),
    instanceId: 'synthetic',
    startedAt: spec.startAt,
    indi: { host: '127.0.0.1', port: 7624 },
    devices: [
      { id: 'primary', kind: 'camera', indiDevice: camera },
      { id: 'mount', kind: 'mount', indiDevice: mount },
      ...(spec.focuser === undefined ? [] : [{ id: 'focuser', kind: 'focuser', indiDevice: spec.focuser }]),
    ],
    limits: { queueBytes: 1, reserveBytes: 0 },
  }

  await mkdir(join(folder, 'blobs'), { recursive: true })
  await Promise.all(blobs.map(([path, bytes]) => writeFile(join(folder, path), bytes)))
  await writeFile(join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(folder, 'traffic.jsonl'), lines.map(line => `${JSON.stringify(line)}\n`).join(''))

  return folder
}
