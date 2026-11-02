/**
 * An AM5 motion fixture: what the driver said after one command, cut from a recording by
 * `measure/cut-am5-motion.py` and played by `playMotion`. It holds no coordinate: positions are offsets from where
 * the mount was when the command arrived (see `play.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FakeVector } from './server.js'

export interface Offset {
  /** Hours. */
  readonly RA: number
  /** Degrees. */
  readonly DEC: number
}

/** One update of one mount property, `afterMs` after the command that starts its phase. */
export type MotionStep = { readonly afterMs: number; readonly property: string; readonly state: FakeVector['state'] } & (
  | { readonly offset: Offset }
  | { readonly values: Readonly<Record<string, boolean>> }
)

export type MotionCommand =
  | { readonly property: string; readonly on: string; readonly rate?: string }
  | { readonly property: string; readonly allOff: true }
  | { readonly property: string; readonly travel: Offset }

export interface MotionPhase {
  readonly command: MotionCommand
  readonly steps: readonly MotionStep[]
  /** A motion that goes on until it is stopped: after the last step, one more reading this far apart, moving by this much. */
  readonly continue?: { readonly everyMs: number; readonly offset: Offset }
  /** The gap between the start and the stop in the recording, for a test that wants the recorded timing. */
  readonly recordedAfterMs?: number
}

export interface MotionFixture {
  readonly format: 1
  readonly name: string
  readonly about: string
  readonly source: { readonly recording: string; readonly startAtS: number; readonly stopAtS?: number }
  readonly start: MotionPhase
  /** What the driver did when a stop (a rate move's switch off, an abort) arrived while the motion went on. */
  readonly stop?: MotionPhase
}

const states = new Set(['Idle', 'Ok', 'Busy', 'Alert'])

function fail(name: string, what: string): never {
  throw new Error(`Motion fixture ${name}: ${what}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function offsetOf(name: string, value: unknown, where: string): Offset {
  if (!isRecord(value) || typeof value.RA !== 'number' || typeof value.DEC !== 'number' || !Number.isFinite(value.RA) || !Number.isFinite(value.DEC)) fail(name, `${where} is not an offset of RA and DEC`)

  return { RA: value.RA, DEC: value.DEC }
}

function commandOf(name: string, value: unknown): MotionCommand {
  if (!isRecord(value) || typeof value.property !== 'string') fail(name, 'a command has no property')
  if (value.allOff === true) return { property: value.property, allOff: true }
  if (value.travel !== undefined) return { property: value.property, travel: offsetOf(name, value.travel, 'a command travel') }
  if (typeof value.on !== 'string') fail(name, 'a command is neither on, allOff nor travel')
  if (value.rate !== undefined && typeof value.rate !== 'string') fail(name, 'a command rate is not a name')

  return value.rate === undefined ? { property: value.property, on: value.on } : { property: value.property, on: value.on, rate: value.rate }
}

function stepOf(name: string, value: unknown, previousAfterMs: number): MotionStep {
  if (!isRecord(value) || typeof value.afterMs !== 'number' || !(value.afterMs >= previousAfterMs)) fail(name, 'steps are not in time order')
  if (typeof value.property !== 'string' || typeof value.state !== 'string' || !states.has(value.state)) fail(name, 'a step has no property or state')
  const head = { afterMs: value.afterMs, property: value.property, state: value.state as FakeVector['state'] }

  if (value.offset !== undefined) return { ...head, offset: offsetOf(name, value.offset, 'a step offset') }
  if (!isRecord(value.values) || !Object.values(value.values).every(on => typeof on === 'boolean')) fail(name, 'a step has neither an offset nor switch values')

  return { ...head, values: value.values as Record<string, boolean> }
}

function phaseOf(name: string, value: unknown): MotionPhase {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length === 0) fail(name, 'a phase has no steps')
  let last = 0
  const steps = value.steps.map(step => {
    const parsed = stepOf(name, step, last)

    last = parsed.afterMs

    return parsed
  })
  const more = value.continue
  const carry = more === undefined ? undefined : isRecord(more) && typeof more.everyMs === 'number' && more.everyMs > 0 ? { everyMs: more.everyMs, offset: offsetOf(name, more.offset, 'continue') } : fail(name, 'continue has no positive everyMs')

  return {
    command: commandOf(name, value.command),
    steps,
    ...(carry === undefined ? {} : { continue: carry }),
    ...(typeof value.recordedAfterMs === 'number' ? { recordedAfterMs: value.recordedAfterMs } : {}),
  }
}

/** Reads a fixture file's JSON, refusing anything `playMotion` could not play. */
export function parseMotionFixture(value: unknown): MotionFixture {
  const name = isRecord(value) && typeof value.name === 'string' ? value.name : '(unnamed)'

  if (!isRecord(value) || value.format !== 1 || name === '(unnamed)' || typeof value.about !== 'string') fail(name, 'format 1 with a name and about is required')
  const source = value.source

  if (!isRecord(source) || typeof source.recording !== 'string' || typeof source.startAtS !== 'number') fail(name, 'source needs a recording and startAtS')
  const start = phaseOf(name, value.start)
  const stop = value.stop === undefined ? undefined : phaseOf(name, value.stop)

  if (stop !== undefined && start.continue === undefined) fail(name, 'a fixture with a stop needs start.continue, so the motion can go on until the stop')

  return {
    format: 1,
    name,
    about: value.about,
    source: { recording: source.recording, startAtS: source.startAtS, ...(typeof source.stopAtS === 'number' ? { stopAtS: source.stopAtS } : {}) },
    start,
    ...(stop === undefined ? {} : { stop }),
  }
}

/** The AM5 fixtures in `fixtures/am5/`, by name. */
export function loadAm5Fixtures(directory: URL = new URL('../fixtures/am5/', import.meta.url)): Readonly<Record<string, MotionFixture>> {
  const folder = fileURLToPath(directory)

  return Object.fromEntries(
    readdirSync(folder)
      .filter(file => file.endsWith('.json'))
      .sort()
      .map(file => {
        const fixture = parseMotionFixture(JSON.parse(readFileSync(`${folder}${file}`, 'utf8')))

        return [fixture.name, fixture]
      }),
  )
}
