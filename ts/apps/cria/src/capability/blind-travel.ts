import type { AcceptedFix } from '@cria/wire'
import { angularDelta, type Position, type Reading } from './stopped.js'
import { marginArcmin } from './envelope.js'

export function makeBlindTravel() {
  const samples: { at: number; total: number }[] = []
  let previous: Position | undefined
  let total = 0

  return {
    record(position: Reading) {
      if (position.at <= (samples.at(-1)?.at ?? -1)) return
      if (!Number.isFinite(position.ra) || !Number.isFinite(position.dec)) return
      if (previous !== undefined) total += Math.hypot(angularDelta(position.ra, previous.ra), position.dec - previous.dec)
      previous = position
      samples.push({ at: position.at, total })
      if (samples.length > 4096) samples.shift()
    },
    margin(fix: AcceptedFix | null) {
      // A late solve resets at exposure time, so travel while ASTAP ran remains charged.
      const anchor = fix === null ? undefined : [...samples].reverse().find(sample => sample.at <= fix.capturedAt)
      const travel = total - (anchor?.total ?? 0)
      return marginArcmin(anchor === undefined ? null : fix?.pointingErrorArcmin ?? null, travel)
    },
  }
}
