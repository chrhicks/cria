import type { AcceptedFix } from '@cria/wire'
import type { Reading } from './stopped.js'
import { axisDelta, type SidedPosition } from './mount-axes.js'
import { marginArcmin } from './envelope.js'

export function makeBlindTravel() {
  const samples: { at: number; total: number }[] = []
  let previous: SidedPosition | undefined
  let total = 0

  return {
    record(position: Reading & Pick<SidedPosition, 'pierSide'>) {
      if (position.at <= (samples.at(-1)?.at ?? -1)) return
      if (!Number.isFinite(position.ra) || !Number.isFinite(position.dec)) return
      if (previous !== undefined) {
        const delta = axisDelta({ from: previous, to: position })
        total += Math.hypot(delta.raDegrees, delta.decDegrees)
      }
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
