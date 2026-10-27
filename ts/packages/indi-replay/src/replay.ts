/**
 * indi-replay: a recording served over TCP like indiserver, so the real Cria
 * can run a recorded night.
 *
 * One camera's images are the clock. Mount, weather, power and the camera's
 * other properties follow the recording only as that camera's frame cursor
 * moves: reserving frame k brings every property to what the drivers said by
 * the time frame k arrived. Time that is not astronomy (how long an exposure
 * waits, how long a fault lasts, liveness) is real time.
 *
 * Who owns a property's value:
 *
 *   tape      follows the recording, until a client writes it
 *   client    a client wrote it: the write is echoed and the property keeps that
 *             value for the rest of the replay (later recorded updates are ignored)
 *   exposure  the camera's exposure properties, driven by the exposure machine
 *
 * Whoever holds a value, the recording owns a property's limits and definition: a recorded min, max or step,
 * or a definition that differs from the one held, is relayed to the clients watching the property.
 *
 * The driver's words are the recording's too: a message on a definition, an update or a deletion, and a
 * `<message>` on its own, reach the clients indiserver would have delivered them to. The exception is a
 * property held by a client or by the exposure machine: the recorded update, and the message on it, is
 * about a value the replay does not share, so neither is relayed.
 *
 * A client's write that the INDI library refuses (a number outside its limits, a one-of-many switch with none or
 * several on) applies nothing and is answered as the drivers answer it (`validate.ts`). A device-wide getProperties
 * is answered with the sets the driver sent inside the recorded answer, where it sent them (`answers.ts`).
 *
 * Writes that would move hardware are refused (Alert, "not in this recording"),
 * and stop and abort requests are confirmed. Nothing is ever simulated beyond
 * what the recording holds.
 */
import { readFile } from 'node:fs/promises'
import { FakeIndi, type Behaviour, type FakeVector, type Limits, type Value } from '@cria/fake-indi'
import { flattened, withExposure } from '@cria/fits'
import { realClock, type Clock } from './clock.js'
import type { Fault, FaultPhase } from './faults.js'
import { localSiderealHours } from './sidereal.js'
import type { Frame, Tape, TapeEvent } from './tape.js'
import { refusal } from './validate.js'
import type { Definition } from './xml.js'

export interface ReplayOptions {
  /** The TCP port on the loopback interface; 0 (default) picks a free one. */
  readonly port?: number
  /** The first frame to serve, and the frame after the last. Default: all frames. */
  readonly fromFrame?: number
  readonly toFrame?: number
  readonly faults?: ReadonlyArray<Fault>
  readonly clock?: Clock
  readonly log?: (line: string) => void
}

export type ReplayEvent = { readonly at: number } & (
  | { readonly kind: 'reserved'; readonly frame: number; readonly seconds: number }
  | { readonly kind: 'delivered'; readonly frame: number; readonly clients: number }
  | { readonly kind: 'aborted'; readonly frame: number }
  | { readonly kind: 'pruned'; readonly frame: number; readonly reason: string }
  | { readonly kind: 'refused'; readonly device: string; readonly property: string; readonly message: string }
  | { readonly kind: 'ended' }
  | { readonly kind: 'fault'; readonly fault: Fault }
)

type Reported = ReplayEvent extends infer Event ? (Event extends { readonly at: number } ? Omit<Event, 'at'> : never) : never

export interface Replay {
  readonly port: number
  /** The index of the next frame to be reserved. */
  readonly cursor: () => number
  readonly phase: () => 'idle' | 'exposing' | 'ended'
  /** The latest events, oldest first; the log keeps `eventLimit` of them. */
  readonly events: () => ReadonlyArray<ReplayEvent>
  /** A property element's value now, as a client would read it. */
  readonly value: (device: string, property: string, element: string) => Value | undefined
  readonly stop: () => Promise<void>
}

export const notInRecording = 'not in this recording'
export const endOfRecording = 'end of recording'

const eventLimit = 1000

const motionProperties = ['EQUATORIAL_EOD_COORD', 'EQUATORIAL_COORD', 'TELESCOPE_PARK', 'TELESCOPE_HOME', 'TELESCOPE_MOTION_WE', 'TELESCOPE_MOTION_NS']
const focuserMotion = ['ABS_FOCUS_POSITION', 'REL_FOCUS_POSITION', 'FOCUS_MOTION']

/** Writes that move hardware, by device kind. A write to one of these is never echoed. */
const refusedWrites: Readonly<Record<string, ReadonlySet<string>>> = {
  mount: new Set(motionProperties),
  focuser: new Set(focuserMotion),
  camera: new Set(['CCD_EXPOSURE']),
}

/** Stop and abort requests: each is confirmed by taking its device's motion properties out of Busy. */
const stopRequests: Readonly<Record<string, ReadonlyArray<string>>> = {
  TELESCOPE_ABORT_MOTION: motionProperties,
  FOCUS_ABORT_MOTION: focuserMotion,
}

const key = (device: string, property: string) => `${device}.${property}`

interface Exposure {
  readonly frame: Frame
  readonly seconds: number
  readonly startedAt: number
  /** Aborted by an abort request, so an image still being written to a slow client stops. */
  readonly delivery: AbortController
  cancel: () => void
}

type Phase = { readonly kind: 'idle' } | { readonly kind: 'exposing'; readonly exposure: Exposure } | { readonly kind: 'ended' }

export async function startReplay(tape: Tape, options: ReplayOptions = {}): Promise<Replay> {
  const clock = options.clock ?? realClock
  const log = options.log ?? (() => undefined)
  const fake = new FakeIndi({ receivedLimit: 100 })
  const camera = tape.camera
  const mount = tape.manifest.devices.find(device => device.kind === 'mount')?.indiDevice
  const first = options.fromFrame ?? 0
  const end = Math.min(options.toFrame ?? tape.frames.length, tape.frames.length)
  const pinned = new Set<string>()
  /** What each pinned property held when it was last written, so a driver that goes away and returns gets it back. */
  const kept = new Map<string, Record<string, Value>>()
  const owned = new Set([key(camera, 'CCD_EXPOSURE'), key(camera, 'CCD_ABORT_EXPOSURE'), key(camera, 'CCD1')])
  const cancels = new Set<() => void>()
  const history: ReplayEvent[] = []
  const blanks = new Set<number>()
  const pending = new Map<string, Fault[]>()
  let phase: Phase = { kind: 'idle' }
  let next = first
  let applied = 0
  let sourceAt = 0
  let longitude: number | undefined
  const writesLst = mount !== undefined && !tape.events.some(event => event.kind === 'define' && event.vector.device === mount && event.vector.name === 'TIME_LST')

  if (first < 0 || first >= tape.frames.length) throw new RangeError(`fromFrame ${first} is outside the ${tape.frames.length} frames`)

  for (const fault of options.faults ?? []) {
    if (fault.kind === 'blank') {
      for (let index = fault.at; index < fault.at + fault.count; index++) blanks.add(index)
      continue
    }

    const slot = `${fault.at}:${fault.phase ?? 'before-exposure'}`

    pending.set(slot, [...(pending.get(slot) ?? []), fault])
  }

  const record = (event: Reported) => {
    history.push({ ...event, at: clock.now() })
    if (history.length > eventLimit) history.shift()
    log(JSON.stringify(history.at(-1)))
  }

  const later = (ms: number, run: () => void) => {
    const cancel = clock.after(ms, () => {
      cancels.delete(cancel)
      run()
    })

    cancels.add(cancel)

    return () => {
      cancels.delete(cancel)
      cancel()
    }
  }

  const clone = (definition: Definition): Definition => ({
    ...definition,
    elements: Object.fromEntries(Object.entries(definition.elements).map(([name, element]) => [name, { ...element }])),
  })

  const noteSite = (event: TapeEvent) => {
    if (event.kind === 'delete' || event.kind === 'message') return
    if (event.kind === 'define' ? event.vector.device !== mount || event.vector.name !== 'GEOGRAPHIC_COORD' : event.device !== mount || event.name !== 'GEOGRAPHIC_COORD') return
    const value = event.kind === 'define' ? event.vector.elements.LONG?.value : event.values.LONG

    if (value !== undefined && Number.isFinite(Number(value))) longitude = Number(value)
  }

  const setStore = (device: string, property: string, change: { state?: FakeVector['state']; values: Readonly<Record<string, Value>>; limits?: Limits; message?: string; timeout?: number }) => {
    const vector = fake.vectors.get(key(device, property))

    if (!vector) return
    const known = <T>(entries: Readonly<Record<string, T>>) => Object.fromEntries(Object.entries(entries).filter(([element]) => element in vector.elements))

    fake.update(device, property, { ...(change.state ? { state: change.state } : {}), values: known(change.values), ...(change.limits ? { limits: known(change.limits) } : {}), ...(change.message === undefined ? {} : { message: change.message }), ...(change.timeout === undefined ? {} : { timeout: change.timeout }) })
  }

  /** What a definition says besides values and state, as text: two definitions with the same shape tell a client the same thing. */
  const shape = (vector: FakeVector) =>
    fake.definition({ ...vector, state: 'Idle', elements: Object.fromEntries(Object.entries(vector.elements).map(([name, element]) => [name, { ...element, value: '' }])) })

  /** A recorded definition of a property we hold is a driver's answer to a getProperties: it changes nothing but values that differ. */
  const refresh = (existing: FakeVector, definition: Definition) => {
    const changed = Object.entries(definition.elements).filter(([name, element]) => name in existing.elements && String(existing.elements[name]!.value) !== String(element.value))

    if (changed.length === 0 && existing.state === definition.state) return
    setStore(existing.device, existing.name, { state: definition.state, values: Object.fromEntries(changed.map(([name, element]) => [name, element.value])) })
  }

  const unchanged = (vector: FakeVector, event: Extract<TapeEvent, { kind: 'update' }>) =>
    (event.state === undefined || event.state === vector.state) && !event.limits && event.message === undefined && Object.entries(event.values).every(([name, value]) => name in vector.elements && String(vector.elements[name]!.value) === String(value))

  /** A client or a fault set this property: it keeps this value against the recording from now on. */
  const pin = (device: string, property: string) => {
    const vector = fake.vectors.get(key(device, property))

    if (!vector) return
    pinned.add(key(device, property))
    kept.set(key(device, property), Object.fromEntries(Object.entries(vector.elements).map(([name, element]) => [name, element.value])))
  }

  const applyEvent = (event: TapeEvent) => {
    noteSite(event)

    if (event.kind === 'message') {
      fake.message(event.device, event.text)

      return
    }

    if (event.kind === 'delete') {
      const message = event.message === undefined ? {} : { message: event.message }

      if (event.name === undefined) fake.removeDevice(event.device, message)
      else fake.removeVector(event.device, event.name, message)

      return
    }

    const slot = event.kind === 'define' ? key(event.vector.device, event.vector.name) : key(event.device, event.name)
    const held = pinned.has(slot) || owned.has(slot)

    if (event.kind === 'define') {
      const existing = fake.vectors.get(slot)
      const definition = { ...clone(event.vector), ...(tape.repeats.has(slot) ? { repeats: tape.repeats.get(slot)! } : {}), ...(tape.answerSets.has(slot) ? { answerSet: tape.answerSets.get(slot)! } : {}) }

      // The driver went away and is defining the property again: a pinned property comes back holding what was written.
      for (const [name, value] of Object.entries(kept.get(slot) ?? {})) if (!existing && name in definition.elements) definition.elements[name]!.value = value

      const message = event.message === undefined ? {} : { message: event.message }

      if (!existing) {
        fake.define(definition, message)
      } else if (shape(existing) !== shape(definition)) {
        // The driver defined the property differently (limits, format, permission, labels, or its kind): clients are told, as indiserver
        // relays it. A definition of another kind is never a refresh, which would write its values into this property: some drivers define
        // properties with no device and no name, in several kinds, and replay holds them as one (`empty-definitions.test.ts`).
        if (held) {
          for (const [name, element] of Object.entries(existing.elements)) if (name in definition.elements) definition.elements[name]!.value = element.value
          definition.state = existing.state
        }
        fake.define({ ...definition, ...(existing.repeats === undefined ? {} : { repeats: existing.repeats }) }, message)
      } else {
        if (!held) refresh(existing, event.vector)
        // A definition that carries the driver's words is not only an answer to a getProperties: clients are told it again, with them.
        if (event.message !== undefined) fake.define(existing, message)
      }

      return
    }

    // A set the driver sends in answer to a getProperties is the replay's to send when asked: from the recording's time it changes nothing the clients do not already hold.
    if (event.answer && fake.vectors.has(slot) && unchanged(fake.vectors.get(slot)!, event)) return

    // A client or the exposure machine holds the values; the driver still owns the limits.
    if (held) {
      if (event.limits) setStore(event.device, event.name, { values: {}, limits: event.limits })

      return
    }

    setStore(event.device, event.name, { ...(event.state ? { state: event.state } : {}), values: event.values, ...(event.limits ? { limits: event.limits } : {}), ...(event.message === undefined ? {} : { message: event.message }), ...(event.timeout === undefined ? {} : { timeout: event.timeout }) })
  }

  /** Brings every property to what the drivers had said by recording time `t`, which is epoch time `at`. */
  const advanceTo = (t: number, at: number) => {
    while (applied < tape.events.length && tape.events[applied]!.t <= t) applyEvent(tape.events[applied++]!)
    sourceAt = at
    publishLst()
  }

  const publishLst = () => {
    if (!writesLst || mount === undefined || longitude === undefined) return
    const values = { LST: localSiderealHours(sourceAt, longitude) }

    if (fake.vectors.has(key(mount, 'TIME_LST'))) fake.update(mount, 'TIME_LST', { state: 'Ok', values })
    else fake.define({ device: mount, name: 'TIME_LST', kind: 'number', perm: 'ro', state: 'Ok', elements: { LST: { value: values.LST, label: 'Local Sidereal Time', min: 0, max: 24, step: 0, format: '%010.6m' } } })
  }

  // The state before the first exposure: as of the moment the exposure that made frame `first` started.
  {
    const source = tape.frames[first]!
    const started = [...tape.events].reverse().find(event => event.kind === 'update' && event.device === camera && event.name === 'CCD_EXPOSURE' && event.state === 'Busy' && event.t < source.t)
    const t = started?.t ?? source.t

    advanceTo(t - 1e-6, source.at - (source.t - t))
  }

  const exposureState = (state: FakeVector['state'], extra: { message?: string; seconds?: number } = {}) => {
    if (!fake.vectors.has(key(camera, 'CCD_EXPOSURE'))) return
    fake.update(camera, 'CCD_EXPOSURE', { state, values: { CCD_EXPOSURE_VALUE: extra.seconds ?? 0 }, ...(extra.message ? { message: extra.message } : {}) })
  }

  const number = (device: string, property: string, element: string) => Number(fake.vectors.get(key(device, property))?.elements[element]?.value)

  /** The geometry the camera is set to, as the size of the image it would make; undefined without CCD_FRAME or CCD_BINNING. */
  const configuredSize = () => {
    const width = Math.floor(number(camera, 'CCD_FRAME', 'WIDTH') / number(camera, 'CCD_BINNING', 'HOR_BIN'))
    const height = Math.floor(number(camera, 'CCD_FRAME', 'HEIGHT') / number(camera, 'CCD_BINNING', 'VER_BIN'))

    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined
  }

  const runFaults = (index: number, when: FaultPhase) => {
    const slot = `${index}:${when}`

    for (const fault of pending.get(slot) ?? []) {
      record({ kind: 'fault', fault })
      applyFault(fault)
    }
    pending.delete(slot)
  }

  const applyFault = (fault: Fault) => {
    switch (fault.kind) {
      case 'blank':
        return
      case 'set':
        setStore(fault.device, fault.property, { ...(fault.state ? { state: fault.state } : {}), values: fault.values })
        pin(fault.device, fault.property)

        return
      case 'silent':
        fake.mute(fault.device)
        later(fault.forMs, () => fake.unmute(fault.device))

        return
      case 'disconnect':
        fake.refusingConnections = true
        fake.dropConnections()
        later(fault.forMs ?? 0, () => {
          fake.refusingConnections = false
        })
    }
  }

  const expose = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
      exposureState('Alert', { message: 'the exposure time is not a number of seconds' })

      return
    }

    if (phase.kind === 'exposing') {
      exposureState('Alert', { message: 'an exposure is already in progress' })

      return
    }

    if (next >= end) {
      phase = { kind: 'ended' }
      record({ kind: 'ended' })
      // Busy first: Cria ignores an Alert that was already there before its command.
      exposureState('Busy', { seconds })
      exposureState('Alert', { message: endOfRecording })

      return
    }

    const frame = tape.frames[next]!
    const size = configuredSize()

    // A pruned frame's size went with its image, so there is nothing to check the camera's geometry against.
    if (frame.pruned === undefined && (size === undefined || size.width !== frame.width || size.height !== frame.height)) {
      const set = size === undefined ? 'unreadable' : `${size.width}x${size.height}`

      exposureState('Alert', { message: `frame ${frame.index} is ${frame.width}x${frame.height}; the camera is set to ${set}` })

      return
    }

    next += 1
    advanceTo(frame.t, frame.at)
    runFaults(frame.index, 'before-exposure')
    const exposure: Exposure = { frame, seconds, startedAt: clock.now(), delivery: new AbortController(), cancel: () => undefined }

    phase = { kind: 'exposing', exposure }
    exposure.cancel = later(seconds * 1000, () => void deliver(exposure))
    record({ kind: 'reserved', frame: frame.index, seconds })
    exposureState('Busy', { seconds })
  }

  const current = (exposure: Exposure) => phase.kind === 'exposing' && phase.exposure === exposure

  const deliver = async (exposure: Exposure) => {
    const { frame } = exposure

    if (!current(exposure)) return
    runFaults(frame.index, 'before-blob')

    if (frame.pruned !== undefined) {
      phase = { kind: 'idle' }
      record({ kind: 'pruned', frame: frame.index, reason: frame.pruned.reason })
      exposureState('Alert', { message: `frame ${frame.index} was pruned from this recording: ${frame.pruned.reason}` })

      return
    }

    try {
      const source = await readFile(frame.path)

      if (!current(exposure)) return
      const stamped = withExposure(source, { seconds: exposure.seconds, startedAt: exposure.startedAt })
      const clients = await fake.deliverBlob(camera, frame.property, frame.element, blanks.has(frame.index) ? flattened(stamped) : stamped, {
        format: frame.format,
        ...(frame.timeout === undefined ? {} : { timeout: frame.timeout }),
        ...(frame.message === undefined ? {} : { message: frame.message }),
        signal: exposure.delivery.signal,
      })

      if (!current(exposure)) return
      phase = { kind: 'idle' }
      record({ kind: 'delivered', frame: frame.index, clients })
      exposureState('Ok')
    } catch (error) {
      if (!current(exposure)) return
      phase = { kind: 'idle' }
      exposureState('Alert', { message: `replay could not deliver frame ${frame.index}: ${String(error)}` })
    }
  }

  const abort = () => {
    if (phase.kind === 'exposing') {
      const { exposure } = phase

      exposure.cancel()
      exposure.delivery.abort()
      phase = { kind: 'idle' }
      record({ kind: 'aborted', frame: exposure.frame.index })
      exposureState('Idle')
    }
    setStore(camera, 'CCD_ABORT_EXPOSURE', { state: 'Ok', values: { ABORT: false } })
  }

  const confirmStop = (device: string, request: string, motion: ReadonlyArray<string>) => {
    for (const property of motion) if (fake.vectors.get(key(device, property))?.state === 'Busy') setStore(device, property, { state: 'Idle', values: {} })
    const elements = Object.keys(fake.vectors.get(key(device, request))?.elements ?? {})

    setStore(device, request, { state: 'Ok', values: Object.fromEntries(elements.map(element => [element, false])) })
  }

  const behaviour: Behaviour = (_, vector, values) => {
    const { device, name } = vector
    const kind = tape.kinds.get(device)

    if (device === camera && name === 'CCD_EXPOSURE') {
      expose(Number(values.CCD_EXPOSURE_VALUE))

      return 'handled'
    }

    if (device === camera && name === 'CCD_ABORT_EXPOSURE') {
      abort()

      return 'handled'
    }

    const motion = stopRequests[name]

    if (motion) {
      confirmStop(device, name, motion)

      return 'handled'
    }

    if (kind !== undefined && refusedWrites[kind]?.has(name)) {
      record({ kind: 'refused', device, property: name, message: notInRecording })
      fake.update(device, name, { state: 'Alert', message: notInRecording })

      return 'handled'
    }

    if (vector.perm === 'ro') return 'handled'
    const refused = refusal(vector, values)

    if (refused) {
      fake.update(device, name, { state: refused.state, message: refused.message, timeout: vector.timeout ?? 0 })
      if (refused.then) fake.update(device, name, { state: refused.then, timeout: vector.timeout ?? 0 })

      return 'handled'
    }

    fake.apply(vector, values)
    fake.update(device, name, { state: 'Ok', timeout: vector.timeout ?? 0 })
    pin(device, name)

    return 'handled'
  }

  fake.behaviour = behaviour
  await fake.start(options.port ?? 0)

  return {
    port: fake.port,
    cursor: () => next,
    phase: () => phase.kind,
    events: () => [...history],
    value: (device, property, element) => fake.vectors.get(key(device, property))?.elements[element]?.value,
    stop: async () => {
      for (const cancel of [...cancels]) cancel()
      await fake.stop()
    },
  }
}
