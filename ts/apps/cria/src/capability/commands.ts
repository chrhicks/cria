/**
 * Disciplines on INDI: how writeOnce, confirm and stoppable meet INDI property
 * states. Shared by every capability so the meaning of Busy, Ok and Alert is
 * decided in one place:
 *
 * - the driver's first update of the property after our send is its answer:
 *   Busy, Ok or Idle accept the command, Alert rejects it;
 * - while waiting for a motion or exposure, Alert fails it, and the device or
 *   the indiserver connection disappearing makes it uncertain.
 */
import { Clock, Effect, Option } from 'effect'
import type { IndiDevice, IndiError, Property, Values } from '@cria/indi'
import { Failed, Uncertain, confirm, writeConfirmed, writeOnce, type Answer, type WriteOnce } from '@cria/primitives'

export interface Timing {
  readonly acknowledgeMs: number
}

/** A send that failed before or during the write. */
function sendFailure(error: IndiError): Failed | Uncertain {
  switch (error.reason) {
    case 'not-connected':
      return new Failed({ reason: 'unavailable', message: error.message })
    case 'unknown-property':
    case 'not-writable':
      return new Failed({ reason: 'unsupported', message: error.message })
    case 'connection-lost':
      return new Uncertain({ reason: 'connection-lost', message: error.message })
  }
}

function describe(device: IndiDevice, property: string) {
  return `${property} on ${device.name}`
}

/**
 * The driver's first answer to a command on `property`. For a motion the
 * answer must be Busy (started), Alert (refused), or an update showing the
 * target already reached (a short focuser move can finish without ever going
 * Busy). Anything else is ignored: drivers that poll their hardware push the
 * same property several times a second, and one of those routine updates can
 * arrive just after our send. If the property was already in Alert before the
 * send, a further Alert is not an answer either (review R1-#8): keep waiting,
 * and without an answer the outcome is uncertain.
 */
function answerOf(device: IndiDevice, property: string, motion: Motion | undefined) {
  return Effect.gen(function* () {
    const subscription = yield* device.subscribe
    // An Alert that was already there before the send says nothing about this command.
    const alertBefore = Option.getOrUndefined(yield* device.property(property))?.state === 'Alert'

    return Effect.gen(function* () {
      while (true) {
        const event = yield* subscription.next

        if (event.type === 'property' && event.origin === 'set' && event.property.name === property) {
          const routine = event.property.state !== 'Busy' && event.property.state !== 'Alert'

          if (motion && routine && !motion.arrived?.(event.property)) continue
          if (alertBefore && event.property.state === 'Alert') continue
          if (event.property.state === 'Alert')
            return { kind: 'rejected', message: event.property.message ?? 'the driver reported Alert' } satisfies Answer<Property>

          return { kind: 'accepted', ack: event.property } satisfies Answer<Property>
        }

        if (event.type === 'deleted' && (event.name === undefined || event.name === property))
          return yield* new Uncertain({ reason: 'driver-lost', message: `${device.name} went away before answering` })

        if (event.type === 'connection' && event.status.kind !== 'connected')
          return yield* new Uncertain({ reason: 'connection-lost', message: 'indiserver connection lost before the driver answered' })
      }
    })
  })
}

interface Motion {
  /** The property shows the motion already complete. */
  readonly arrived?: (property: Property) => boolean
}

function write(device: IndiDevice, property: string, values: Values, timing: Timing, motion?: Motion): WriteOnce<Property, never> {
  return {
    command: describe(device, property),
    listen: answerOf(device, property, motion),
    send: device.send(property, values).pipe(Effect.mapError(sendFailure)),
    within: timing.acknowledgeMs,
  }
}

/** writeOnce on an INDI property: returns the acknowledging update. */
export function sendOnce(device: IndiDevice, property: string, values: Values, timing: Timing) {
  return writeOnce(write(device, property, values, timing))
}

/** writeOnce for a command that starts a motion or exposure (see answerOf). */
export function startMotion(device: IndiDevice, property: string, values: Values, timing: Timing, motion: Motion = {}) {
  return writeOnce(write(device, property, values, timing, motion)).pipe(Effect.asVoid)
}

/** The property as the mirror holds it now. */
export function current(device: IndiDevice, property: string): Effect.Effect<Property, Failed> {
  return device.property(property).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new Failed({ reason: 'unsupported', message: `${device.name} has no ${property}` })),
        onSome: Effect.succeed,
      }),
    ),
  )
}

/**
 * A switch setting (tracking on, cooler on, connect): write once, then confirm
 * the exact readback, uninterruptibly. A readback that never matches is
 * uncertain.
 *
 * `holds` decides what "settled" means, because INDI's Busy is not uniform:
 * TELESCOPE_TRACK_STATE stays Busy for as long as tracking is engaged, while
 * CONNECTION is Busy only while the connection is being made.
 */
export function switchConfirmed(
  device: IndiDevice,
  property: string,
  values: Values,
  holds: (property: Property) => boolean,
  timing: Timing & { readonly confirmMs?: number },
) {
  return writeConfirmed(write(device, property, values, timing), () => ({
    command: describe(device, property),
    read: current(device, property),
    holds: (observed: Property) => observed.state !== 'Alert' && holds(observed),
    within: timing.confirmMs ?? 15_000,
  }))
}

function numbersOf(observed: Property, elements: ReadonlyArray<string>) {
  return elements.map(element => {
    const found = observed.elements.get(element)

    return found?.kind === 'number' ? found.value : Number.NaN
  })
}

export function settledNumbers(device: IndiDevice, property: string, elements: ReadonlyArray<string>, quietMs: number) {
  return Effect.gen(function* () {
    let held = { values: '', since: 0 }

    while (true) {
      const observed = yield* current(device, property)
      const now = yield* Clock.currentTimeMillis
      const values = observed.state === 'Busy' ? 'Busy' : numbersOf(observed, elements).join()

      if (values !== held.values) held = { values, since: now }
      if (observed.state !== 'Busy' && now - held.since >= quietMs) return observed

      yield* Effect.sleep('50 millis')
    }
  })
}

/**
 * A number setting (binning, frame, gain): write once, then wait for the
 * driver's echo of what it applied. INDI drivers echo the value they actually
 * set, and may adjust it (a ZWO camera rounds a subframe width to a multiple
 * of 8). Settled at the requested values, within `tolerance` per element (the
 * driver's own resolution), is confirmed. Settled at new values the driver
 * chose is a known state: `failed: rejected`, naming them. Still showing the
 * old values at the deadline proves nothing either way: uncertain (review
 * R1-#10; the first update after a send can be a routine one).
 */
export function numbersApplied(
  device: IndiDevice,
  property: string,
  values: Readonly<Record<string, number>>,
  timing: Timing & { readonly confirmMs?: number },
  tolerance: Readonly<Record<string, number>> = {},
) {
  const elements = Object.keys(values)
  const wanted = Object.values(values)
  const near = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, slack: (element: string) => number) =>
    a.every((value, index) => Math.abs(value - b[index]!) <= Math.max(slack(elements[index]!), 1e-9, Math.abs(b[index]!) * 1e-9))

  return Effect.uninterruptible(
    Effect.gen(function* () {
      const before = numbersOf(yield* current(device, property), elements)

      yield* sendOnce(device, property, values, timing)

      const echo = Effect.gen(function* () {
        while (true) {
          const observed = yield* current(device, property)

          if (observed.state !== 'Busy') {
            const applied = numbersOf(observed, elements)

            if (near(applied, wanted, element => tolerance[element] ?? 0)) return observed
            if (!near(applied, before, () => 0)) {
              const named = elements.map((element, index) => `${element}=${applied[index]}`).join(', ')

              return yield* new Failed({ reason: 'rejected', message: `${describe(device, property)}: the driver applied ${named}` })
            }
          }

          yield* Effect.sleep('50 millis')
        }
      })

      const settled = yield* Effect.timeoutOption(echo, timing.confirmMs ?? 15_000)

      if (Option.isSome(settled)) return settled.value

      return yield* new Uncertain({ reason: 'not-confirmed', message: `${describe(device, property)}: the driver still shows the old values` })
    }),
  )
}

/** confirm on the mirror: the property reaches a state. */
export function confirmProperty(
  device: IndiDevice,
  property: string,
  holds: (property: Property) => boolean,
  withinMs: number,
) {
  return confirm({
    command: describe(device, property),
    read: current(device, property),
    holds,
    within: withinMs,
    every: '50 millis',
  })
}

/** confirm on the mirror: none of `properties` that the device defines is Busy. */
export function confirmNoneBusy(device: IndiDevice, properties: ReadonlyArray<string>, withinMs: number) {
  return confirm({
    command: `stop on ${device.name}`,
    read: device.properties,
    holds: (defined: ReadonlyArray<Property>) => !defined.some(property => properties.includes(property.name) && property.state === 'Busy'),
    within: withinMs,
    every: '50 millis',
  })
}

/**
 * Waits for a motion or exposure on `property` to finish. Completes when the
 * property leaves Busy and `done` holds; Alert fails it; the driver or the
 * connection disappearing makes it uncertain; `deadlineMs` fails it (and the
 * stoppable around it then stops the device).
 */
export function untilSettled(
  device: IndiDevice,
  property: string,
  done: (property: Property) => boolean,
  deadlineMs: number,
): Effect.Effect<Property, Failed | Uncertain> {
  const wait = Effect.scoped(
    Effect.gen(function* () {
      const subscription = yield* device.subscribe
      const now = yield* current(device, property)

      if (now.state !== 'Busy' && done(now)) return now

      while (true) {
        const event = yield* subscription.next

        if (event.type === 'property' && event.property.name === property) {
          if (event.property.state === 'Alert')
            return yield* new Failed({ reason: 'rejected', message: event.property.message ?? `${describe(device, property)} reported Alert` })
          if (event.property.state !== 'Busy' && done(event.property)) return event.property
        }

        if (event.type === 'deleted' && (event.name === undefined || event.name === property))
          return yield* new Uncertain({ reason: 'driver-lost', message: `${device.name} went away during the operation` })

        if (event.type === 'connection' && event.status.kind !== 'connected')
          return yield* new Uncertain({ reason: 'connection-lost', message: 'indiserver connection lost during the operation' })
      }
    }),
  )

  return wait.pipe(
    Effect.timeoutOption(deadlineMs),
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () =>
          Effect.fail(new Failed({ reason: 'unavailable', message: `${describe(device, property)} did not finish within ${deadlineMs} ms` })),
      }),
    ),
  )
}

/**
 * For a request that is not a physical command (BLOB routing): its failure is
 * not an outcome, so it is deliberately not reported.
 */
export function notACommand(effect: Effect.Effect<void, IndiError>): Effect.Effect<void> {
  return Effect.exit(effect).pipe(Effect.asVoid)
}
