/**
 * The motion record of one mount command (`MotionRecord` on the wire): what was sent, where the mount was, and how
 * it came to rest. It is noted as soon as the command is known to have gone out, with the stop undecided
 * (`uncertain`), and noted again when the one "stopped" rule (stopped.ts) fires.
 */
import { Clock, Effect } from 'effect'
import type { MotionAxes, MotionCommanded, MotionRecord } from '@cria/wire'
import { angularDelta, type Command, type Position } from './stopped.js'

/** Hands the operation's record to the ledger, which keeps the latest one until the operation settles. */
export type Note = (record: MotionRecord) => Effect.Effect<void>

type Resting = Exclude<MotionRecord['stopped']['how'], 'uncertain'>

export interface Tracking {
  /** Runs the command's start, and notes the record once it is known to have gone out. */
  readonly sentBy: <A, E extends { readonly _tag: string }, R>(start: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** The stopped rule fired: the mount rests at `position`. */
  readonly rested: (how: Resting, position: Position) => Effect.Effect<void>
}

const axes = (position: Position): MotionAxes => ({ rightAscensionDegrees: position.ra, declinationDegrees: position.dec })

/** A command that went out, or may have: refused or never sent leaves no record. */
const wentOut = (error: { readonly _tag: string }) => error._tag === 'Uncertain'

export function track(note: Note, commanded: MotionCommanded, command: Command): Tracking {
  const from = command.before === undefined ? null : axes(command.before)
  const sent: MotionRecord = {
    commanded,
    observed: { from, to: null, travel: null },
    stopped: { how: 'uncertain', at: null },
  }

  return {
    sentBy: start => start.pipe(Effect.tap(() => note(sent)), Effect.tapError(error => (wentOut(error) ? note(sent) : Effect.void))),
    rested: (how, position) =>
      Effect.flatMap(Clock.currentTimeMillis, at =>
        note({
          ...sent,
          observed: {
            from,
            to: axes(position),
            travel: command.before === undefined ? null : { rightAscensionDegrees: angularDelta(position.ra, command.before.ra), declinationDegrees: position.dec - command.before.dec },
          },
          stopped: { how, at },
        }),
      ),
  }
}
