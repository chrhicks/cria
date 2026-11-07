/**
 * Capability: device setup (docs/ts/SPEC.md, "Device setup"). The AM5 refuses
 * every goto until its site and time are set after it powers on.
 */
import { Clock, Data, Effect, Ref, Schedule } from 'effect'
import type { Values } from '@cria/indi'
import { Failed, type Uncertain, type Reading } from '@cria/primitives'
import type { DeviceKind } from '@cria/wire'
import type { DeviceConfig } from '../config.js'
import { confirmProperty, numbersApplied, sendOnce, switchConfirmed } from './commands.js'
import { liveSnapshot, type CapabilityContext } from './context.js'
import { switchElement, textElement, type DeviceSnapshot } from './fields.js'

export interface StepOutcome {
  readonly property: string
  /** Sent and confirmed, or nothing was needed. */
  readonly done: boolean
  readonly text: string
}

type Plan =
  | { readonly kind: 'write'; readonly property: string; readonly values: Values; readonly write: Effect.Effect<unknown, Failed | Uncertain> }
  | { readonly kind: 'none'; readonly outcome: StepOutcome }

type Step = (context: CapabilityContext, snapshot: DeviceSnapshot, device: DeviceConfig, now: number) => Effect.Effect<Plan, Failed | DefinitionsSettling>

const setting = { alertMeansStale: false }

const kept = (property: string, why: string): Plan => ({ kind: 'none', outcome: { property, done: true, text: `${property} ${why}` } })
const notSent = (property: string, why: string): Plan => ({ kind: 'none', outcome: { property, done: false, text: `${property} not sent: ${why}` } })

class DefinitionsSettling extends Data.TaggedError('DefinitionsSettling')<{ readonly property: string }> {}

function defines(reading: Reading.Reading<unknown>, property: string): Effect.Effect<boolean, Failed | DefinitionsSettling> {
  if (reading.status !== 'unavailable') return Effect.succeed(true)
  if (reading.reason === 'unsupported') return Effect.succeed(false)
  if (reading.reason === 'not-read') return Effect.fail(new DefinitionsSettling({ property }))

  return Effect.fail(new Failed({ reason: 'unavailable', message: `${property} is not read: ${reading.message ?? reading.reason}` }))
}

const uploadToClient: Step = (context, snapshot) =>
  Effect.gen(function* () {
    const local = snapshot.reading('UPLOAD_MODE', switchElement('UPLOAD_LOCAL'), setting)

    if (!(yield* defines(local, 'UPLOAD_MODE'))) return kept('UPLOAD_MODE', 'is not defined: frames go to clients')
    if (local.status !== 'unavailable' && !local.value) return kept('UPLOAD_MODE', 'already sends frames to Cria')

    const values = { UPLOAD_CLIENT: true }

    return {
      kind: 'write',
      property: 'UPLOAD_MODE',
      values,
      write: switchConfirmed(context.device, 'UPLOAD_MODE', values, property => switchElement('UPLOAD_CLIENT')(property) === true, context.timing),
    }
  })

const driverDebug: Step = (context, snapshot) =>
  Effect.gen(function* () {
    const enabled = snapshot.reading('DEBUG', switchElement('ENABLE'), setting)

    if (!(yield* defines(enabled, 'DEBUG'))) return kept('DEBUG', 'is not defined by this driver')

    const level = snapshot.reading('DEBUG_LEVEL', switchElement('DBG_DEBUG'), setting)

    if (enabled.status !== 'unavailable' && enabled.value && level.status !== 'unavailable' && level.value) return kept('DEBUG', 'is already on')

    const enable = switchConfirmed(context.device, 'DEBUG', { ENABLE: true }, property => switchElement('ENABLE')(property) === true, context.timing)
    const levelDefined = confirmProperty(context.device, 'DEBUG_LEVEL', () => true, context.timing.acknowledgeMs)
    const raise = switchConfirmed(context.device, 'DEBUG_LEVEL', { DBG_DEBUG: true }, property => switchElement('DBG_DEBUG')(property) === true, context.timing)

    return {
      kind: 'write',
      property: 'DEBUG',
      values: { ENABLE: true, DBG_DEBUG: true },
      write: Effect.andThen(enable, Effect.andThen(levelDefined, raise)).pipe(
        Effect.catch(error => Effect.logWarning(`${context.device.name}: driver debug not set: ${error.message}`)),
      ),
    }
  })

const site: Step = (context, snapshot, device) =>
  Effect.gen(function* () {
    if (!device.site) return notSent('GEOGRAPHIC_COORD', 'no site is configured for this mount')
    if (!(yield* defines(snapshot.reading('GEOGRAPHIC_COORD', () => true, setting), 'GEOGRAPHIC_COORD')))
      return notSent('GEOGRAPHIC_COORD', 'the mount does not define it')

    // INDI longitude is 0 to 360 east.
    const values = { LAT: device.site.latitudeDegrees, LONG: (device.site.longitudeDegrees + 360) % 360, ELEV: device.site.elevationMeters }

    return { kind: 'write', property: 'GEOGRAPHIC_COORD', values, write: numbersApplied(context.device, 'GEOGRAPHIC_COORD', values, context.timing) }
  })

const time: Step = (context, snapshot, _device, now) =>
  Effect.gen(function* () {
    if (!(yield* defines(snapshot.reading('TIME_UTC', () => true, setting), 'TIME_UTC'))) return notSent('TIME_UTC', 'the mount does not define it')

    const values = { UTC: new Date(now).toISOString().slice(0, 19), OFFSET: '0.00' }
    const write = Effect.andThen(
      sendOnce(context.device, 'TIME_UTC', values, context.timing),
      confirmProperty(context.device, 'TIME_UTC', property => property.state !== 'Alert' && textElement('UTC')(property) === values.UTC, context.timing.confirmMs),
    )

    return { kind: 'write', property: 'TIME_UTC', values, write }
  })

const steps: { readonly [K in DeviceKind]: ReadonlyArray<Step> } = {
  camera: [uploadToClient],
  mount: [site, time],
  focuser: [],
  box: [],
}

function describeValues(values: Values): string {
  return Object.entries(values)
    .map(([element, value]) => `${element}=${typeof value === 'boolean' ? (value ? 'On' : 'Off') : value}`)
    .join(' ')
}

export interface DeviceSetup {
  readonly hasSteps: boolean
  /** What setup did since the device connected; undefined while it is due. */
  readonly current: Effect.Effect<ReadonlyArray<StepOutcome> | undefined>
  /** Runs every step in order and records what happened; returns the summary an operation reports. */
  readonly run: Effect.Effect<string | undefined, Failed>
  readonly endSession: Effect.Effect<void>
}

export function makeDeviceSetup(context: CapabilityContext, device: DeviceConfig): Effect.Effect<DeviceSetup> {
  const kindSteps = device.driverDebug === true ? [...steps[device.kind], driverDebug] : steps[device.kind]

  return Effect.gen(function* () {
    const state = yield* Ref.make<{ readonly session: number; readonly outcomes: ReadonlyArray<StepOutcome> | undefined }>({
      session: 0,
      outcomes: kindSteps.length === 0 ? [] : undefined,
    })
    const record = (session: number, outcomes: ReadonlyArray<StepOutcome>) =>
      Ref.update(state, current => (current.session === session ? { session, outcomes } : current))
    const plan = (step: Step) =>
      Effect.gen(function* () {
        return yield* step(context, yield* liveSnapshot(context), device, yield* Clock.currentTimeMillis)
      }).pipe(
        Effect.retry({ while: error => error._tag === 'DefinitionsSettling', schedule: Schedule.spaced('250 millis') }),
        Effect.mapError(error => (error._tag === 'DefinitionsSettling' ? new Failed({ reason: 'unavailable', message: `${error.property} is not read yet` }) : error)),
      )

    const run = Effect.gen(function* () {
      const { session } = yield* Ref.get(state)
      const outcomes: StepOutcome[] = []

      for (const step of kindSteps) {
        const planned = yield* plan(step)

        if (planned.kind === 'none') {
          outcomes.push(planned.outcome)
          continue
        }

        yield* planned.write.pipe(
          Effect.tapError(error => record(session, [...outcomes, { property: planned.property, done: false, text: `${planned.property} failed: ${error.message}` }])),
          Effect.mapError(error =>
            new Failed({ reason: error._tag === 'Failed' ? error.reason : 'unavailable', message: `setup: ${planned.property}: ${error.message}` }),
          ),
        )
        outcomes.push({ property: planned.property, done: true, text: `sent ${planned.property} ${describeValues(planned.values)}` })
      }

      yield* record(session, outcomes)

      return kindSteps.length === 0 ? undefined : outcomes.map(outcome => outcome.text).join('; ')
    })

    return {
      hasSteps: kindSteps.length > 0,
      current: Effect.map(Ref.get(state), current => current.outcomes),
      run,
      endSession: Ref.update(state, current => ({ session: current.session + 1, outcomes: kindSteps.length === 0 ? [] : undefined })),
    }
  })
}
