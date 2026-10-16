/**
 * Capability: camera. An INDI CCD seen through the disciplines:
 * capture is `stoppable` (expose, then abort on cancel and confirm idle),
 * settings are `numbersApplied` / `switchConfirmed`, cooling is `writeOnce`
 * plus readback. Never sees XML; speaks INDI property names only here.
 */
import { Effect } from 'effect'
import type { DeviceSubscription, Property } from '@cria/indi'
import { Failed, Reading, Uncertain, stoppable, type Ending, type Report } from '@cria/primitives'
import { readFitsHeader } from '../image/fits.js'
import { confirmProperty, current, notACommand, numbersApplied, sendOnce, settledNumbers, startMotion, switchConfirmed } from './commands.js'
import { invalid, liveSnapshot, required, type CapabilityContext } from './context.js'
import { firstNumberElement, limitElement, numberElement, switchElement, textElement, type DeviceSnapshot } from './fields.js'
import type { DeviceBody, Image, ParamsOf, Progress, ReadingsOf } from '@cria/wire'

type R<T> = Reading.Reading<T>

export type BayerPattern = Exclude<Image['color'], 'mono'>

export interface CapturedFrame {
  readonly fits: Buffer
  readonly width: number
  readonly height: number
  readonly binX: number
  readonly binY: number
  readonly startX: number
  readonly startY: number
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

const region = {
  X: { key: 'startX', axis: 'x' },
  Y: { key: 'startY', axis: 'y' },
  WIDTH: { key: 'width', axis: 'x' },
  HEIGHT: { key: 'height', axis: 'y' },
} as const

type FrameElement = keyof typeof region
type RegionKey = (typeof region)[FrameElement]['key']
type PerAxis = { readonly x: number; readonly y: number }

export type FrameGrid = Partial<Record<RegionKey, number>>

/**
 * How long CCD_FRAME must hold still to count as the driver's final frame:
 * indi_asi_ccd recomputes the frame by itself after a binning change.
 */
const frameSettleMs = 1000

function readings(snapshot: DeviceSnapshot): ReadingsOf<'camera'> {
  const read = snapshot.reading
  const binX = read('CCD_BINNING', numberElement('HOR_BIN'))
  const binY = read('CCD_BINNING', numberElement('VER_BIN'))
  // INDI's CCD_FRAME is unbinned; ASCOM, and so the wire, reports binned pixels.
  const binned = (frame: R<number>, bin: R<number>) => Reading.both(frame, bin, (pixels, factor) => Math.floor(pixels / factor))

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
    binX,
    binY,
    width: binned(read('CCD_FRAME', numberElement('WIDTH')), binX),
    height: binned(read('CCD_FRAME', numberElement('HEIGHT')), binY),
    startX: binned(read('CCD_FRAME', numberElement('X')), binX),
    startY: binned(read('CCD_FRAME', numberElement('Y')), binY),
    maxBinX: read('CCD_BINNING', limitElement(['HOR_BIN'], 'max')),
    maxBinY: read('CCD_BINNING', limitElement(['VER_BIN'], 'max')),
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

export function makeCamera(context: CapabilityContext, frameGrid: FrameGrid = {}): Camera {
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
          binX: yield* required(camera.binX, 'binning'),
          binY: yield* required(camera.binY, 'binning'),
          startX: yield* required(camera.startX, 'subframe origin'),
          startY: yield* required(camera.startY, 'subframe origin'),
        }
        const minimum = yield* required(camera.exposureMinimum, 'minimum exposure')
        const maximum = yield* required(camera.exposureMaximum, 'maximum exposure')

        if (request.exposureSeconds < minimum || request.exposureSeconds > maximum)
          return yield* invalid(`Exposure ${request.exposureSeconds} s is outside ${minimum}-${maximum} s`)

        const color = colorAtOrigin(yield* required(camera.bayerPattern, 'sensor colour'), geometry)

        if (color !== 'mono' && (request.monochromeOnly || geometry.binX !== 1 || geometry.binY !== 1))
          return yield* invalid('This consumer needs a mono or unbinned Bayer image')

        yield* uploadsToClient(snapshot)
        yield* frameType(context, snapshot, request.light)

        // Subscribe before the exposure starts so even a very short frame's
        // BLOB can't arrive unseen.
        yield* notACommand(device.enableBlobs('Also'))
        yield* Effect.addFinalizer(() => notACommand(device.enableBlobs('Never')))
        const events = yield* device.subscribe
        const dispatchedAt = Date.now()

        const fits = yield* stoppable({
          command: `exposure on ${device.name}`,
          start: Effect.gen(function* () {
            yield* startMotion(device, 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: request.exposureSeconds }, timing)
            yield* report({ phase: 'exposing' })
          }),
          settle: frameArrival(context, events, report, dispatchedAt, request.exposureSeconds, geometry),
          stop: abort,
          stopWithin: 15_000,
          // An exposure error with the abort confirmed leaves an idle camera and no frame:
          // nothing moved, nothing persists, so it is a plain failure, not a quarantine.
          settleFailure: 'failed',
        })

        yield* report({ phase: 'readout' })

        return { fits, ...geometry, color, dispatchedAt }
      }),
    )

  const configure = (settings: ParamsOf<'camera-configure'>) =>
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(context)
      const camera = readings(snapshot)

      if ((yield* required(camera.activity, 'camera state')) !== 'idle')
        return yield* new Failed({ reason: 'busy', message: 'Camera settings need an idle camera' })

      const bin = {
        x: settings.binX ?? (yield* required(camera.binX, 'binning')),
        y: settings.binY ?? (yield* required(camera.binY, 'binning')),
      }

      if (bin.x > (yield* required(camera.maxBinX, 'maximum binning')) || bin.y > (yield* required(camera.maxBinY, 'maximum binning')))
        return yield* invalid('Unsupported binning')

      for (const [key, low, high] of [
        ['gain', camera.gainMinimum, camera.gainMaximum],
        ['offset', camera.offsetMinimum, camera.offsetMaximum],
      ] as const) {
        const wanted = settings[key]

        if (wanted === undefined) continue
        if (wanted < (yield* required(low, `${key} minimum`)) || wanted > (yield* required(high, `${key} maximum`)))
          return yield* invalid(`Invalid ${key}`)
      }

      const rebinning = settings.binX !== undefined || settings.binY !== undefined
      const frame = Object.values(region).some(field => settings[field.key] !== undefined)
        ? yield* sensorFrame(settings, bin, yield* required(snapshot.reading('CCD_FRAME', property => property), 'subframe'), {
            x: yield* required(camera.sensorWidthPixels, 'sensor width'),
            y: yield* required(camera.sensorHeightPixels, 'sensor height'),
          }, frameGrid)
        : undefined

      if (rebinning) yield* Effect.uninterruptible(Effect.andThen(numbersApplied(device, 'CCD_BINNING', { HOR_BIN: bin.x, VER_BIN: bin.y }, timing), frameSettled))
      if (frame) yield* numbersApplied(device, 'CCD_FRAME', frame, timing)

      if (settings.gain !== undefined) yield* setControl(context, snapshot, gainProperties, ['GAIN', 'Gain'], settings.gain)
      if (settings.offset !== undefined) yield* setControl(context, snapshot, offsetProperties, ['OFFSET', 'Offset'], settings.offset)

      return {
        ...(rebinning || frame ? yield* appliedGeometry : {}),
        ...(settings.gain === undefined ? {} : { gain: settings.gain }),
        ...(settings.offset === undefined ? {} : { offset: settings.offset }),
      }
    })

  const frameSettled = settledNumbers(device, 'CCD_FRAME', ['X', 'Y', 'WIDTH', 'HEIGHT'], frameSettleMs).pipe(
    Effect.timeoutOption(timing.operationTimeoutMs),
    Effect.flatMap(settled =>
      settled._tag === 'Some'
        ? Effect.void
        : Effect.fail(new Uncertain({ reason: 'not-confirmed', message: `CCD_FRAME on ${device.name} did not settle after the binning change` })),
    ),
  )

  const appliedGeometry = Effect.gen(function* () {
    const binning = yield* current(device, 'CCD_BINNING')
    const frame = yield* current(device, 'CCD_FRAME')
    const bin = { x: numberElement('HOR_BIN')(binning) ?? Number.NaN, y: numberElement('VER_BIN')(binning) ?? Number.NaN }

    const binned = (element: FrameElement) => Math.floor((numberElement(element)(frame) ?? Number.NaN) / bin[region[element].axis])

    return { binX: bin.x, binY: bin.y, startX: binned('X'), startY: binned('Y'), width: binned('WIDTH'), height: binned('HEIGHT') }
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

/**
 * CCD_FRAME is in unbinned sensor pixels. A ZWO camera given a frame off its
 * grid uses a smaller frame while CCD_FRAME shows the one asked for, and its
 * next exposure never completes. So every field sent, asked or kept, must be
 * on the grid: the configured one in binned pixels, and the step the driver
 * advertises in sensor pixels.
 */
function sensorFrame(
  settings: ParamsOf<'camera-configure'>,
  bin: PerAxis,
  frame: Property,
  sensorPixels: PerAxis,
  grid: FrameGrid,
): Effect.Effect<Record<FrameElement, number>, Failed> {
  const pixels = (element: FrameElement) => {
    const { key, axis } = region[element]
    const definition = frame.elements.get(element)

    if (definition?.kind !== 'number') return Effect.fail(new Failed({ reason: 'unsupported', message: `CCD_FRAME has no ${element}` }))

    const factor = bin[axis]
    const binned = settings[key] ?? definition.value / factor
    const step = definition.step > 0 ? definition.step : 1
    const spacing = lcm(grid[key] ?? 1, step / gcd(step, factor))

    if (binned % spacing === 0) return Effect.succeed(binned * factor)

    const below = Math.floor(binned / spacing) * spacing
    const nearest = [below, below + spacing].filter(value => value * factor >= definition.min && value * factor <= definition.max)

    return Effect.fail(
      invalid(
        `${key} ${binned} binned pixels${settings[key] === undefined ? ` (the current ${key})` : ''}; the camera needs a multiple of ${spacing} binned pixels; ` +
          (nearest.length > 0 ? `nearest ${nearest.join(' or ')}` : `no ${key} near it fits`),
      ),
    )
  }

  return Effect.gen(function* () {
    const target = yield* Effect.all({ X: pixels('X'), Y: pixels('Y'), WIDTH: pixels('WIDTH'), HEIGHT: pixels('HEIGHT') })

    for (const [start, size] of [['X', 'WIDTH'], ['Y', 'HEIGHT']] as const) {
      const { axis } = region[size]
      const end = target[start] + target[size]

      if (end > sensorPixels[axis])
        return yield* invalid(
          `Subframe exceeds the sensor: ${region[start].key} ${target[start] / bin[axis]} + ${region[size].key} ${target[size] / bin[axis]} binned pixels ` +
            `at bin ${bin[axis]} is ${end} sensor pixels; the sensor has ${sensorPixels[axis]}`,
        )
    }

    return target
  })
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

function colorAtOrigin(
  pattern: Image['color'],
  geometry: { startX: number; startY: number; binX: number; binY: number },
): Image['color'] {
  return pattern === 'mono' ? 'mono' : shiftPattern(pattern, geometry.startX * geometry.binX, geometry.startY * geometry.binY)
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

/** Light or dark is part of the requested capture, so Cria sets it when it differs. */
function frameType(context: CapabilityContext, snapshot: DeviceSnapshot, light: boolean) {
  const wanted = light ? 'FRAME_LIGHT' : 'FRAME_DARK'
  const property = snapshot.property('CCD_FRAME_TYPE')

  if (!property) return light ? Effect.void : Effect.fail(new Failed({ reason: 'unsupported', message: 'Camera has no frame type' }))
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
 * frames are skipped; if only those arrive, the outcome is uncertain at the
 * deadline. Alert on CCD_EXPOSURE after our start fails the exposure; losing
 * the driver or the connection makes it uncertain.
 */
function frameArrival(
  context: CapabilityContext,
  events: DeviceSubscription,
  report: Report<Progress>,
  dispatchedAt: number,
  exposureSeconds: number,
  geometry: { readonly width: number; readonly height: number },
): Effect.Effect<Buffer, Failed | Uncertain> {
  const { device, timing } = context
  const deadlineMs = exposureSeconds * 1000 + timing.readoutAllowanceMs
  const skipped: string[] = []

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
        skipped.push(mismatch)
      }

      if (event.type === 'deleted' && event.name === undefined)
        return yield* new Uncertain({ reason: 'driver-lost', message: `${device.name} went away during the exposure` })
      if (event.type === 'connection' && event.status.kind !== 'connected')
        return yield* new Uncertain({ reason: 'connection-lost', message: 'indiserver connection lost during the exposure' })
    }
  })

  const timedOut = () =>
    skipped.length > 0
      ? new Uncertain({ reason: 'not-confirmed', message: `Only frames that were not this exposure arrived (${skipped.join('; ')})` })
      : new Failed({
          reason: 'unavailable',
          message: `No frame arrived within the ${exposureSeconds} s exposure and the ${timing.readoutAllowanceMs / 1000} s readout allowance`,
        })

  return Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.forkScoped(elapsed)

      return yield* wait.pipe(
        Effect.timeoutOption(deadlineMs),
        Effect.flatMap(found => (found._tag === 'Some' ? Effect.succeed(found.value) : Effect.fail(timedOut()))),
      )
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
