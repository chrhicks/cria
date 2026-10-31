/**
 * How an axis motion's start meets the driver's first answer (docs/ts/SPEC.md, writeOnce table): Busy
 * starts it, Alert refuses it, and an Idle or Ok update received after the send that shows the requested
 * switch Off is a refusal too. A routine update that echoes the request, and any update received before
 * the send, are never a refusal.
 */
import { Effect, Option, PubSub } from 'effect'
import { describe, expect, it } from 'vitest'
import type { DeviceEvent, IndiDevice, Property } from '@cria/indi'
import { startMotion, switchNotStarted } from './commands.js'

const delay = (ms: number) => Effect.promise(() => new Promise<void>(resolve => setTimeout(resolve, ms)))

function motion(state: Property['state'], on: boolean, receivedAt: number): Property {
  return {
    device: 'Mount',
    name: 'TELESCOPE_MOTION_WE',
    kind: 'switch',
    label: 'Motion',
    state,
    perm: 'rw',
    elements: new Map([
      ['MOTION_WEST', { kind: 'switch' as const, name: 'MOTION_WEST', label: 'West', on: false }],
      ['MOTION_EAST', { kind: 'switch' as const, name: 'MOTION_EAST', label: 'East', on }],
    ]),
    receivedAt,
  }
}

/** Drives `script` once the send has returned: each step waits, then the driver says `build(now)`. */
function start(before: ReadonlyArray<(now: number) => Property>, script: ReadonlyArray<readonly [ms: number, build: (now: number) => Property]>) {
  const sent: string[] = []

  const run = Effect.gen(function* () {
    const events = yield* PubSub.unbounded<DeviceEvent>()
    const publish = (property: Property) => PubSub.publish(events, { type: 'property', origin: 'set', property })
    const device = {
      name: 'Mount',
      property: () => Effect.succeed(Option.none()),
      subscribe: PubSub.subscribe(events).pipe(Effect.map(subscription => ({ next: PubSub.take(subscription) }))),
      send: () =>
        Effect.gen(function* () {
          sent.push('TELESCOPE_MOTION_WE')
          // Updates the driver sent before it heard our write, delivered while the send is under way.
          for (const build of before) yield* publish(build(Date.now() - 1000))
          yield* delay(5)
          yield* Effect.forkDetach(
            Effect.gen(function* () {
              for (const [ms, build] of script) {
                yield* delay(ms)
                yield* publish(build(Date.now()))
              }
            }),
          )
        }),
    } as unknown as IndiDevice

    return yield* startMotion(device, 'TELESCOPE_MOTION_WE', { MOTION_EAST: true }, { acknowledgeMs: 300 }, { refused: switchNotStarted('MOTION_EAST') })
  })

  return { sent, run: () => Effect.runPromise(Effect.flip(run)).then(error => error as { _tag: string; reason: string; message: string }) , ok: () => Effect.runPromise(run) }
}

describe('an axis motion start and the first answer', () => {
  it('Busy starts it', async () => {
    const { ok, sent } = start([], [[10, now => motion('Busy', true, now)]])

    await expect(ok()).resolves.toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('an Idle answer with the switch Off is a refusal, failed rejected, and says so', async () => {
    const { run } = start([], [[10, now => motion('Idle', false, now)]])
    const error = await run()

    expect([error._tag, error.reason]).toEqual(['Failed', 'rejected'])
    expect(error.message).toBe('TELESCOPE_MOTION_WE on Mount: the driver answered Idle and did not start MOTION_EAST (it stayed Off)')
  })

  it('an Ok answer with the switch Off is a refusal too', async () => {
    const { run } = start([], [[10, now => motion('Ok', false, now)]])

    expect((await run()).reason).toBe('rejected')
  })

  it('a routine Idle update that echoes the requested switch On is ignored, and the Busy after it starts the motion', async () => {
    const { ok } = start([], [[10, now => motion('Idle', true, now)], [10, now => motion('Busy', true, now)]])

    await expect(ok()).resolves.toBeUndefined()
  })

  it('an Idle update from before the send is never a refusal: the Busy after the send starts the motion', async () => {
    const { ok } = start([now => motion('Idle', false, now)], [[20, now => motion('Busy', true, now)]])

    await expect(ok()).resolves.toBeUndefined()
  })

  it('with only an update from before the send, it is no answer at all: uncertain after the deadline', async () => {
    const { run } = start([now => motion('Idle', false, now)], [])
    const error = await run()

    expect([error._tag, error.reason]).toEqual(['Uncertain', 'no-acknowledgement'])
  })

  it('an Alert is still a refusal', async () => {
    const { run } = start([], [[10, now => motion('Alert', false, now)]])

    expect((await run()).reason).toBe('rejected')
  })
})
