/**
 * Plays AM5 motion fixtures on a fake mount: when a client sends the command a fixture was cut from, the fake sends
 * the property updates the driver sent then, in the recorded order and at the recorded times.
 *
 * A fixture holds offsets, not positions. Updates in the start phase are offsets from the mount's position when the
 * command arrived. After a stop they are offsets from where the mount would be at the stop had it kept the speed of
 * its last two readings (or its last reading, if there is one), the estimate the cutter made from the recording. A
 * mount that is moved again while a motion plays is not modelled: the new motion replaces the old, tail included.
 *
 * The position only changes when a fixture says so. A goto fixture plays only for a goto of the size it recorded
 * (`travel`), and a home keeps the recorded travel from wherever it starts, with Dec held within the poles.
 */
import { performance } from 'node:perf_hooks'
import type { Behaviour, FakeIndi, FakeVector } from './server.js'
import type { MotionCommand, MotionFixture, MotionPhase, MotionStep } from './motion.js'

/** Time as a played motion uses it. Tests pass a clock they advance by hand. */
export interface MotionClock {
  /** Milliseconds on a monotonic clock. */
  readonly now: () => number
  /** Runs `run` after `ms`; returns a function that cancels it. */
  readonly after: (ms: number, run: () => void) => () => void
}

export const realMotionClock: MotionClock = {
  now: () => performance.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms)

    timer.unref()

    return () => clearTimeout(timer)
  },
}

export interface PlayOptions {
  /** How much faster than recorded: 100 plays a 14 s goto in 0.14 s. Default 1. */
  readonly timeScale?: number
  readonly clock?: MotionClock
}

interface Position {
  readonly ra: number
  readonly dec: number
}

interface Reading extends Position {
  readonly recordedMs: number
}

interface Playing {
  readonly fixture: MotionFixture
  readonly origin: Position
  readonly startedAt: number
  readonly readings: Reading[]
}

const position = 'EQUATORIAL_EOD_COORD'
const matchTolerance = 0.0001

const added: Record<string, Omit<FakeVector, 'device'>> = {
  TARGET_EOD_COORD: { name: 'TARGET_EOD_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { RA: { value: 0, max: 24 }, DEC: { value: 0, min: -90, max: 90 } } },
  TELESCOPE_PIER_SIDE: { name: 'TELESCOPE_PIER_SIDE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { PIER_WEST: { value: false }, PIER_EAST: { value: true } } },
}

const wrapHours = (hours: number) => ((hours % 24) + 24) % 24

const hoursBetween = (from: number, to: number) => ((to - from + 36) % 24) - 12

const clampDec = (degrees: number) => Math.max(-90, Math.min(90, degrees))

function currentPosition(fake: FakeIndi, device: string): Position {
  const { elements } = fake.vector(device, position)

  return { ra: Number(elements.RA!.value), dec: Number(elements.DEC!.value) }
}

function extrapolate(playing: Playing, atMs: number): Position {
  const [before, last] = playing.readings.slice(-2)

  if (last === undefined) return playing.origin
  if (before === undefined) return last
  const intervals = (atMs - last.recordedMs) / (last.recordedMs - before.recordedMs)

  return { ra: wrapHours(last.ra + hoursBetween(before.ra, last.ra) * intervals), dec: last.dec + (last.dec - before.dec) * intervals }
}

function matches(command: MotionCommand, vector: FakeVector, values: Record<string, string>, fake: FakeIndi): boolean {
  if (vector.name !== command.property) return false
  if ('allOff' in command) return Object.values(values).every(value => value === 'Off')

  if ('travel' in command) {
    const from = currentPosition(fake, vector.device)

    return Math.abs(hoursBetween(from.ra + command.travel.RA, Number(values.RA))) < matchTolerance && Math.abs(from.dec + command.travel.DEC - Number(values.DEC)) < matchTolerance
  }

  return values[command.on] === 'On' && (command.rate === undefined || fake.vector(vector.device, 'TELESCOPE_SLEW_RATE').elements[command.rate]?.value === true)
}

function defineMissing(fake: FakeIndi, device: string, fixtures: readonly MotionFixture[]): void {
  for (const fixture of fixtures)
    for (const phase of [fixture.start, fixture.stop])
      for (const { property } of phase?.steps ?? []) {
        if (fake.vectors.has(`${device}.${property}`)) continue
        const missing = added[property]

        if (missing === undefined) throw new Error(`Motion fixture ${fixture.name} updates ${property}, which the fake mount ${device} does not define`)
        fake.define({ device, ...missing })
      }
}

/**
 * Makes `fake` play `fixtures` on `device` whenever a client sends the command a fixture starts with (the first that matches
 * plays), and the fixture's stop phase when the stop it recorded arrives while it plays. Any other command goes to the
 * behaviour the fake had. Defines TARGET_EOD_COORD and TELESCOPE_PIER_SIDE if the mount lacks them.
 */
export function playMotion(fake: FakeIndi, device: string, fixtures: readonly MotionFixture[], options: PlayOptions = {}): void {
  const { timeScale = 1, clock = realMotionClock } = options
  const pending = new Set<() => void>()
  let playing: Playing | undefined
  const elapsed = (from: number) => (clock.now() - from) * timeScale

  defineMissing(fake, device, fixtures)

  const cancelAll = () => {
    for (const cancel of pending) cancel()
    pending.clear()
  }

  const emit = (step: MotionStep, origin: Position, motion: Playing | undefined) => {
    if (!('offset' in step)) return void fake.update(device, step.property, { state: step.state, values: step.values })
    const here = { ra: wrapHours(origin.ra + step.offset.RA), dec: clampDec(origin.dec + step.offset.DEC) }

    fake.update(device, step.property, { state: step.state, values: { RA: here.ra, DEC: here.dec } })
    if (motion !== undefined && step.property === position) motion.readings.push({ recordedMs: step.afterMs, ...here })
  }

  const schedule = (phase: MotionPhase, origin: Position, motion: Playing | undefined) => {
    const times = [...new Set(phase.steps.map(step => step.afterMs))]

    for (const time of times) {
      const cancel = clock.after(time / timeScale, () => {
        pending.delete(cancel)
        for (const step of phase.steps) if (step.afterMs === time) emit(step, origin, motion)
      })

      pending.add(cancel)
    }
  }

  const keepGoing = (phase: MotionPhase, motion: Playing) => {
    const more = phase.continue
    const last = phase.steps.flatMap(step => ('offset' in step && step.property === position ? [step] : [])).at(-1)

    if (more === undefined || last === undefined) return
    const tick = (count: number) => {
      const cancel = clock.after((count === 1 ? last.afterMs + more.everyMs : more.everyMs) / timeScale, () => {
        pending.delete(cancel)
        emit({ ...last, afterMs: last.afterMs + count * more.everyMs, offset: { RA: last.offset.RA + count * more.offset.RA, DEC: last.offset.DEC + count * more.offset.DEC } }, motion.origin, motion)
        tick(count + 1)
      })

      pending.add(cancel)
    }

    tick(1)
  }

  const previous = fake.behaviour

  const behaviour: Behaviour = (self, vector, values, client) => {
    if (vector.device === device && playing?.fixture.stop !== undefined && matches(playing.fixture.stop.command, vector, values, self)) {
      const motion = playing
      const stop = playing.fixture.stop

      cancelAll()
      schedule(stop, extrapolate(motion, elapsed(motion.startedAt)), undefined)
      playing = undefined

      return 'handled'
    }

    const fixture = vector.device === device ? fixtures.find(candidate => matches(candidate.start.command, vector, values, self)) : undefined

    if (fixture === undefined) return previous(self, vector, values, client)
    cancelAll()
    playing = { fixture, origin: currentPosition(self, device), startedAt: clock.now(), readings: [] }
    schedule(fixture.start, playing.origin, playing)
    keepGoing(fixture.start, playing)

    return 'handled'
  }

  fake.behaviour = behaviour
  fake.onStop(cancelAll)
}
