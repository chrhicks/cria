/**
 * Capability: camera. An INDI CCD seen through the disciplines:
 * capture is `stoppable` (expose, then abort on cancel and confirm idle),
 * settings are `numbersApplied` / `switchConfirmed`, cooling is `writeOnce`
 * plus readback. Never sees XML; speaks INDI property names only here.
 */
import { Effect } from 'effect'
import type { DeviceSubscription } from '@cria/indi'
import { Failed, Reading, Uncertain, stoppable, type Ending, type Report } from '@cria/primitives'
import { readFitsHeader } from '@cria/fits'
import { confirmProperty, notACommand, numbersApplied, sendOnce, startMotion, switchConfirmed } from './commands.js'
import { invalid, liveSnapshot, required, type CapabilityContext } from './context.js'
import { firstNumberElement, limitElement, numberElement, switchElement, textElement, type DeviceSnapshot } from './fields.js'
import type { CaptureFrameType, DeviceBody, Image, ParamsOf, Progress, ReadingsOf } from '@cria/wire'

type R<T> = Reading.Reading<T>

export type BayerPattern = Exclude<Image['color'], 'mono'>

export interface CapturedFrame {
  readonly cameraName: string
  readonly fits: Buffer
  readonly width: number
  readonly height: number
  readonly color: Image['color']
  readonly dispatchedAt: number
}

export interface Camera {
  readonly observe: Effect.Effect<DeviceBody<'camera'>>
  readonly capture: (request: ParamsOf<'capture'>, report: Report<Progress>) => Effect.Effect<CapturedFrame, Ending>
  readonly configure: (settings: ParamsOf<'camera-configure'>) => Effect.Effect<ParamsOf<'camera-configure'>, Failed | Uncertain>
  readonly cooling: (request: ParamsOf<'cooling'>) => Effect.Effect<ParamsOf<'cooling'>, Failed | Uncertain>
}

/** Properties whose Alert means "the last command failed", not "this value is old". */
const command = { alertMeansStale: false }

const gainProperties = ['CCD_GAIN', 'CCD_CONTROLS']
const offsetProperties = ['CCD_OFFSET', 'CCD_CONTROLS']

function readings(snapshot: DeviceSnapshot): ReadingsOf<'camera'> {
  const read = snapshot.reading

  return {
    connected: snapshot.connected,
    name: snapshot.name,
    // Alert after an abort or a failed frame: the camera is idle again.
    activity: read('CCD_EXPOSURE', property => (property.state === 'Busy' ? 'exposing' : 'idle'), command),
    temperatureC: read('CCD_TEMPERATURE', numberElement('CCD_TEMPERATURE_VALUE')),
    // INDI reports the sensor temperature, never the target.
    setpointC: Reading.unavailable('unsupported'),
    coolerOn: read('CCD_COOLER', switchElement('COOLER_ON')),
    coolerPowerPercent: read('CCD_COOLER_POWER', numberElement('CCD_COOLER_VALUE')),
    sensorWidthPixels: read('CCD_INFO', numberElement('CCD_MAX_X')),
    sensorHeightPixels: read('CCD_INFO', numberElement('CCD_MAX_Y')),
    pixelWidthMicrons: read('CCD_INFO', numberElement('CCD_PIXEL_SIZE_X')),
    pixelHeightMicrons: read('CCD_INFO', numberElement('CCD_PIXEL_SIZE_Y')),
    width: read('CCD_FRAME', numberElement('WIDTH')),
    height: read('CCD_FRAME', numberElement('HEIGHT')),
    bayerPattern: cfa(snapshot),
    canAbortExposure: read('CCD_EXPOSURE', () => snapshot.property('CCD_ABORT_EXPOSURE') !== undefined, command),
    canSetTemperature: read('CCD_INFO', () => snapshot.property('CCD_TEMPERATURE')?.perm === 'rw'),
    canGetCoolerPower: read('CCD_INFO', () => snapshot.property('CCD_COOLER_POWER') !== undefined),
    exposureMinimum: read('CCD_EXPOSURE', limitElement(['CCD_EXPOSURE_VALUE'], 'min'), command),
    exposureMaximum: read('CCD_EXPOSURE', limitElement(['CCD_EXPOSURE_VALUE'], 'max'), command),
    gain: read(gainProperties, firstNumberElement(['GAIN', 'Gain'])),
    gainMinimum: read(gainProperties, limitElement(['GAIN', 'Gain'], 'min')),
    gainMaximum: read(gainProperties, limitElement(['GAIN', 'Gain'], 'max')),
    offset: read(offsetProperties, firstNumberElement(['OFFSET', 'Offset'])),
    offsetMinimum: read(offsetProperties, limitElement(['OFFSET', 'Offset'], 'min')),
    offsetMaximum: read(offsetProperties, limitElement(['OFFSET', 'Offset'], 'max')),
  }
}

/** The colour pattern at the sensor origin, or mono when the camera reports no CFA. */
function cfa(snapshot: DeviceSnapshot): R<Image['color']> {
  if (!snapshot.property('CCD_CFA')) return Reading.map(snapshot.reading('CCD_INFO', () => true), () => 'mono' as const)

  return snapshot.reading('CCD_CFA', property => {
    const type = textElement('CFA_TYPE')(property)?.toLowerCase()
    // INDI's CCD_CFA is a text vector: the offsets arrive as strings.
    const offsetX = Number(textElement('CFA_OFFSET_X')(property) ?? 0)
    const offsetY = Number(textElement('CFA_OFFSET_Y')(property) ?? 0)

    return isPattern(type) && Number.isInteger(offsetX) && Number.isInteger(offsetY) ? shiftPattern(type, offsetX, offsetY) : undefined
  })
}

function isPattern(value: string | undefined): value is BayerPattern {
  return value === 'rggb' || value === 'grbg' || value === 'gbrg' || value === 'bggr'
}

/** The pattern seen from a pixel `dx`, `dy` away from where `pattern` starts. */
export function shiftPattern(pattern: BayerPattern, dx: number, dy: number): BayerPattern {
  let [a, b, c, d] = pattern.split('') as [string, string, string, string]

  if (Math.abs(dx) % 2 === 1) [a, b, c, d] = [b, a, d, c]
  if (Math.abs(dy) % 2 === 1) [a, b, c, d] = [c, d, a, b]

  return `${a}${b}${c}${d}` as BayerPattern
}

export function makeCamera(context: CapabilityContext): Camera {
  const { device, timing } = context
  let lastCommanded: DeviceBody<'camera'>['lastCommandedSetpointC'] = null

  const abort = Effect.gen(function* () {
    yield* sendOnce(device, 'CCD_ABORT_EXPOSURE', { ABORT: true }, timing)
    yield* confirmProperty(device, 'CCD_EXPOSURE', property => property.state !== 'Busy', 10_000)
  })

  const capture = (request: ParamsOf<'capture'>, report: Report<Progress>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* liveSnapshot(context)
        const camera = readings(snapshot)

        if ((yield* required(camera.activity, 'camera state')) !== 'idle')
          return yield* new Failed({ reason: 'busy', message: `${device.name} is not idle` })

        const geometry = {
          width: yield* required(camera.width, 'image width'),
          height: yield* required(camera.height, 'image height'),
        }
        const minimum = yield* required(camera.exposureMinimum, 'minimum exposure')
        const maximum = yield* required(camera.exposureMaximum, 'maximum exposure')

        if (request.exposureSeconds < minimum || request.exposureSeconds > maximum)
          return yield* invalid(`Exposure ${request.exposureSeconds} s is outside ${minimum}-${maximum} s`)

        const type = request.frameType ?? (request.light ? 'light' : 'dark')
        // A bias frame has no exposure time: the driver exposes at its minimum whatever is asked.
        const exposureSeconds = type === 'bias' ? minimum : request.exposureSeconds
        const color = yield* required(camera.bayerPattern, 'sensor colour')

        if (color !== 'mono' && request.monochromeOnly)
          return yield* invalid('This consumer needs a mono image')

        yield* uploadsToClient(snapshot)
        yield* frameType(context, snapshot, type)

        // Subscribe before the exposure starts so even a very short frame's
        // BLOB can't arrive unseen.
        yield* notACommand(device.enableBlobs('Also'))
        yield* Effect.addFinalizer(() => notACommand(device.enableBlobs('Never')))
        const events = yield* device.subscribe
        const dispatchedAt = Date.now()

        const fits = yield* stoppable({
          command: `exposure on ${device.name}`,
          start: Effect.gen(function* () {
            yield* startMotion(device, 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: exposureSeconds }, timing)
            yield* report({ phase: 'exposing' })
          }),
          settle: frameArrival(context, events, report, dispatchedAt, exposureSeconds, geometry),
          stop: abort,
          stopWithin: 15_000,
          // An exposure error with the abort confirmed leaves an idle camera and no frame:
          // nothing moved, nothing persists, so it is a plain failure.
          settleFailure: 'failed',
        })

        yield* report({ phase: 'readout' })

        return { cameraName: device.name, fits, ...geometry, color, dispatchedAt }
      }),
    )

  const configure = (settings: ParamsOf<'camera-configure'>) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const camera = readings(snapshot)

      if ((yield* required(camera.activity, 'camera state')) !== 'idle')
        return yield* new Failed({ reason: 'busy', message: 'Camera settings need an idle camera' })

      for (const [key, low, high] of [
        ['gain', camera.gainMinimum, camera.gainMaximum],
        ['offset', camera.offsetMinimum, camera.offsetMaximum],
      ] as const) {
        const wanted = settings[key]

        if (wanted === undefined) continue
        if (wanted < (yield* required(low, `${key} minimum`)) || wanted > (yield* required(high, `${key} maximum`)))
          return yield* invalid(`Invalid ${key}`)
      }

      if (settings.gain !== undefined) yield* setControl(context, snapshot, gainProperties, ['GAIN', 'Gain'], settings.gain)
      if (settings.offset !== undefined) yield* setControl(context, snapshot, offsetProperties, ['OFFSET', 'Offset'], settings.offset)

      return {
        ...(settings.gain === undefined ? {} : { gain: settings.gain }),
        ...(settings.offset === undefined ? {} : { offset: settings.offset }),
      }
    })

  const cooling = (request: ParamsOf<'cooling'>) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const camera = readings(snapshot)

      if (!(yield* required(camera.canSetTemperature, 'cooling control')))
        return yield* new Failed({ reason: 'unsupported', message: 'Camera cooling control unsupported' })

      const result: { coolerOn?: boolean; setpointC?: number } = {}

      if (request.setpointC !== undefined) {
        // INDI's CCD_TEMPERATURE reports the sensor temperature, not the target,
        // and is pushed every poll, so a routine update proves nothing. INDI's CCD
        // base class answers a new setpoint with Busy (regulating towards it) or
        // Ok when already there; only those count (review R1-#9).
        const setpoint = request.setpointC

        yield* startMotion(device, 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: setpoint }, timing, {
          arrived: property =>
            property.state === 'Ok' && Math.abs((numberElement('CCD_TEMPERATURE_VALUE')(property) ?? Number.NaN) - setpoint) <= 0.5,
        })
        lastCommanded = { value: setpoint, commandedAt: Date.now() }
        result.setpointC = request.setpointC
      }

      if (request.coolerOn !== undefined) {
        if (!snapshot.property('CCD_COOLER'))
          return yield* new Failed({ reason: 'unsupported', message: 'Camera has no cooler switch' })
        const on = request.coolerOn

        yield* switchConfirmed(
          device,
          'CCD_COOLER',
          on ? { COOLER_ON: true } : { COOLER_OFF: true },
          property => switchElement('COOLER_ON')(property) === on,
          timing,
        )
        result.coolerOn = on
      }

      return result
    })

  return {
    observe: Effect.map(context.snapshot, snapshot => ({ kind: 'camera', readings: readings(snapshot), lastCommandedSetpointC: lastCommanded })),
    capture,
    configure,
    cooling,
  }
}

function uploadsToClient(snapshot: DeviceSnapshot): Effect.Effect<void, Failed> {
  const mode = snapshot.property('UPLOAD_MODE')

  if (mode && switchElement('UPLOAD_LOCAL')(mode) === true)
    return Effect.fail(invalid('The camera saves frames locally only; set UPLOAD_MODE to client'))

  const format = snapshot.property('CCD_TRANSFER_FORMAT')

  if (format && switchElement('FORMAT_FITS')(format) !== true)
    return Effect.fail(invalid('The camera transfers a format other than FITS'))

  return Effect.void
}

const indiFrameTypes = { light: 'FRAME_LIGHT', dark: 'FRAME_DARK', flat: 'FRAME_FLAT', bias: 'FRAME_BIAS' } as const satisfies Record<CaptureFrameType, string>

/** The frame type is part of the requested capture, so Cria sets it when it differs. */
function frameType(context: CapabilityContext, snapshot: DeviceSnapshot, type: CaptureFrameType) {
  const wanted = indiFrameTypes[type]
  const property = snapshot.property('CCD_FRAME_TYPE')

  if (!property) return type === 'light' ? Effect.void : Effect.fail(new Failed({ reason: 'unsupported', message: 'Camera has no frame type' }))
  if (!property.elements.has(wanted)) return Effect.fail(new Failed({ reason: 'unsupported', message: `Camera has no ${type} frame type` }))
  if (switchElement(wanted)(property) === true) return Effect.void

  return switchConfirmed(context.device, 'CCD_FRAME_TYPE', { [wanted]: true }, found => switchElement(wanted)(found) === true, context.timing)
}

function setControl(
  context: CapabilityContext,
  snapshot: DeviceSnapshot,
  properties: ReadonlyArray<string>,
  elements: ReadonlyArray<string>,
  value: number,
) {
  for (const name of properties) {
    const property = snapshot.property(name)
    const element = elements.find(candidate => property?.elements.get(candidate)?.kind === 'number')

    if (property && element) return numbersApplied(context.device, name, { [element]: value }, context.timing).pipe(Effect.asVoid)
  }

  return Effect.fail(new Failed({ reason: 'unsupported', message: `Camera has no ${elements[0]?.toLowerCase()} control` }))
}

/**
 * Waits for the BLOB of our own exposure. Reports elapsed time while waiting.
 *
 * Another client (PHD2 on the guide camera) or a late frame from an aborted
 * exposure can deliver a main-chip BLOB too, so a frame is ours only if it
 * arrives after our CCD_EXPOSURE went Busy and its FITS header matches the
 * request: EXPTIME, size, and a DATE-OBS no earlier than our dispatch. Other
 * frames are skipped. Alert on CCD_EXPOSURE after our start fails the exposure;
 * losing the driver or the connection makes it uncertain. There is no deadline:
 * a client that sees the camera has stopped counting cancels the operation.
 */
function frameArrival(
  context: CapabilityContext,
  events: DeviceSubscription,
  report: Report<Progress>,
  dispatchedAt: number,
  exposureSeconds: number,
  geometry: { readonly width: number; readonly height: number },
): Effect.Effect<Buffer, Failed | Uncertain> {
  const { device } = context

  const elapsed = Effect.forever(
    Effect.andThen(Effect.suspend(() => report({ elapsedSeconds: (Date.now() - dispatchedAt) / 1000 })), Effect.sleep('250 millis')),
  )

  const wait = Effect.gen(function* () {
    let started = false

    while (true) {
      const event = yield* events.next

      if (event.type === 'property' && event.property.name === 'CCD_EXPOSURE') {
        if (event.property.state === 'Busy') started = true
        if (started && event.property.state === 'Alert')
          return yield* new Failed({ reason: 'rejected', message: event.property.message ?? 'The camera reported an exposure error' })
      }

      // CCD1 is the main chip; CCD2 (a built-in guide chip) is not this exposure.
      if (event.type === 'blob' && event.blob.property === 'CCD1' && event.blob.data.length > 0) {
        const mismatch = started ? notOurFrame(event.blob.data, exposureSeconds, geometry, dispatchedAt) : 'arrived before this exposure started'

        if (mismatch === undefined) return event.blob.data
        yield* Effect.logWarning(`${device.name}: skipped a frame that is not this exposure: ${mismatch}`)
      }

      if (event.type === 'deleted' && event.name === undefined)
        return yield* new Uncertain({ reason: 'driver-lost', message: `${device.name} went away during the exposure` })
      if (event.type === 'connection' && event.status.kind !== 'connected')
        return yield* new Uncertain({ reason: 'connection-lost', message: 'indiserver connection lost during the exposure' })
    }
  })

  return Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.forkScoped(elapsed)

      return yield* wait
    }),
  )
}

/** Why a FITS frame is not the one this exposure asked for, or undefined if it is. */
function notOurFrame(
  fits: Buffer,
  exposureSeconds: number,
  geometry: { readonly width: number; readonly height: number },
  dispatchedAt: number,
): string | undefined {
  let cards: Map<string, string>

  try {
    cards = readFitsHeader(fits).cards
  } catch {
    return 'unreadable FITS header'
  }

  const exptime = Number(cards.get('EXPTIME'))
  const width = Number(cards.get('NAXIS1'))
  const height = Number(cards.get('NAXIS2'))
  const dateObs = cards.get('DATE-OBS')
  const startedAt = dateObs ? Date.parse(/[zZ]$/.test(dateObs) ? dateObs : `${dateObs}Z`) : Number.NaN

  if (!(Math.abs(exptime - exposureSeconds) <= Math.max(0.001, exposureSeconds * 0.005))) return `EXPTIME ${cards.get('EXPTIME')}`
  if (width !== geometry.width || height !== geometry.height) return `${width}x${height}`
  // DATE-OBS is stamped by the driver when the exposure starts, on the same host's
  // clock as Cria (errai): it can't be earlier than our dispatch beyond rounding.
  // 0.5 s (was 2 s, which let a late frame from an aborted short exposure pass;
  // review R2 P3d). If indiserver ever runs on another host, revisit this margin.
  if (Number.isFinite(startedAt) && startedAt < dispatchedAt - 500) return `DATE-OBS ${dateObs}`

  return undefined
}
