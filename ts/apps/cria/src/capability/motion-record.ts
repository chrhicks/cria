import { Clock, Effect } from 'effect'
import type { IndiDevice } from '@cria/indi'
import type { MotionAxes, MotionCommanded, MotionRecord } from '@cria/wire'
import { angularDelta, positionOf, type Command, type Position } from './stopped.js'

export type Note = (record: MotionRecord) => Effect.Effect<void>
type Resting = Exclude<MotionRecord['stopped']['how'], 'uncertain'>

export interface Tracking {
  readonly sentBy: <A, E extends { readonly _tag: string }, R>(start: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly rested: (how: Resting, position: Position) => Effect.Effect<void>
}

const axes = (position: Position): MotionAxes => ({ rightAscensionDegrees: position.ra, declinationDegrees: position.dec })

export function track(device: IndiDevice, note: Note, commanded: MotionCommanded, command: Command) {
  return Effect.gen(function* () {
    let from: Position | undefined
    const subscription = yield* device.subscribe

    yield* Effect.forkScoped(Effect.forever(Effect.gen(function* () {
      const event = yield* subscription.next

      if (from !== undefined || event.type !== 'property' || !['EQUATORIAL_EOD_COORD', 'EQUATORIAL_COORD'].includes(event.property.name)) return
      if (event.property.receivedAt <= command.sentAt) return
      const position = positionOf(event.property)

      if (Number.isFinite(position.ra) && Number.isFinite(position.dec)) from = position
    })))

    const record = (how: MotionRecord['stopped']['how'], to: Position | null, at: number | null): MotionRecord => ({
      commanded,
      observed: {
        from: from === undefined ? null : axes(from),
        to: to === null ? null : axes(to),
        travel: from === undefined || to === null ? null : { rightAscensionDegrees: angularDelta(to.ra, from.ra), declinationDegrees: to.dec - from.dec },
      },
      stopped: { how, at },
    })

    return {
      sentBy: start => start.pipe(
        Effect.tap(() => note(record('uncertain', null, null))),
        Effect.tapError(error => error._tag === 'Uncertain' ? note(record('uncertain', null, null)) : Effect.void),
      ),
      rested: (how, position) => Effect.flatMap(Clock.currentTimeMillis, at => note(record(how, position, at))),
    } satisfies Tracking
  })
}
