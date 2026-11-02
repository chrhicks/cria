import type { MountEnvelope } from '@cria/wire'

export interface MountPose {
  readonly hourAngleDegrees: number
  readonly declinationDegrees: number
  readonly pierSide: 'east' | 'west'
}

type Point = Pick<MountPose, 'hourAngleDegrees' | 'declinationDegrees'>

// Step 3's worst recorded 9x coast after a stop, rounded up in arcseconds.
export const stopTravelDegrees = 4084 / 3600

function boxRefusal(envelope: MountEnvelope, from: MountPose, to: Point, meridianLimit: number): string | undefined {
  const lowHa = Math.min(from.hourAngleDegrees, to.hourAngleDegrees)
  const highHa = Math.max(from.hourAngleDegrees, to.hourAngleDegrees)
  const lowDec = Math.min(from.declinationDegrees, to.declinationDegrees)
  const highDec = Math.max(from.declinationDegrees, to.declinationDegrees)

  if (![lowHa, highHa, lowDec, highDec].every(Number.isFinite)) return 'Envelope needs finite mount coordinates'
  if (lowHa < -180 || highHa > 180) return 'Envelope path crosses the hour-angle wrap limit'
  if (lowDec < -90 || highDec > 90) return 'Envelope path crosses the declination limit'

  for (const side of ['normal', 'flipped'] as const) {
    const negative = (side === 'normal') === (from.pierSide === 'west')
    const low = negative ? lowHa : Math.max(0, lowHa)
    const high = negative ? Math.min(0, highHa) : highHa

    if (low > high || (side === 'flipped' && low === 0 && high === 0)) continue
    if (side === 'flipped' && Math.max(Math.abs(low), Math.abs(high)) > meridianLimit)
      return `Envelope flipped-side meridian limit ${meridianLimit}° exceeded; beyond it the side is unmeasured`

    const bands = envelope.keepOut.filter(band => band.side === side)

    if (side === 'flipped' && bands.length === 0) continue
    const intersecting = bands.filter(band => band.minDeclinationDegrees <= highDec && band.maxDeclinationDegrees >= lowDec)
    const covered = [...intersecting].sort((a, b) => a.minDeclinationDegrees - b.minDeclinationDegrees)
    let through = lowDec

    for (const band of covered) {
      if (band.minDeclinationDegrees > through) break
      through = Math.max(through, band.maxDeclinationDegrees)
    }
    if (covered.length === 0 || covered[0]!.minDeclinationDegrees > lowDec || through < highDec) return `Envelope ${side} side has an unmeasured Dec band`

    for (const band of intersecting) {
      if (band.eastHourAngleDegrees !== undefined && low < band.eastHourAngleDegrees)
        return `Envelope ${band.name}: east HA limit ${band.eastHourAngleDegrees}° exceeded`
      if (band.westHourAngleDegrees !== undefined && high > band.westHourAngleDegrees)
        return `Envelope ${band.name}: west HA limit ${band.westHourAngleDegrees}° exceeded`
    }
  }

  return undefined
}

export function gotoRefusal(envelope: MountEnvelope, from: MountPose, to: Point, meridianLimit: number): string | undefined {
  const start = boxRefusal(envelope, from, from, meridianLimit)

  if (start !== undefined) return start
  const sides: ReadonlyArray<MountPose['pierSide']> = Math.abs(to.hourAngleDegrees) <= meridianLimit
    ? ['east', 'west']
    : [to.hourAngleDegrees < 0 ? 'west' : 'east']

  const nearPole = from.declinationDegrees >= 89 && from.declinationDegrees <= 90
  const reflectedHa = (from.hourAngleDegrees + 360) % 360 - 180
  const poleHa = Math.abs(reflectedHa) > 90 && Math.abs(reflectedHa) <= 90.05 ? Math.sign(reflectedHa) * 90 : reflectedHa

  for (const pierSide of sides) {
    const startPose = nearPole && pierSide !== from.pierSide
      ? { hourAngleDegrees: poleHa, declinationDegrees: 90, pierSide }
      : { ...from, pierSide }
    const refusal = boxRefusal(envelope, startPose, to, meridianLimit)

    if (refusal !== undefined) return refusal
  }

  return undefined
}

export function rateRefusal(envelope: MountEnvelope, from: MountPose, travelRaDegrees: number, meridianLimit: number): string | undefined {
  const start = boxRefusal(envelope, from, from, meridianLimit)

  if (start !== undefined) return start
  const travel = travelRaDegrees + Math.sign(travelRaDegrees) * stopTravelDegrees

  return boxRefusal(envelope, from, { ...from, hourAngleDegrees: from.hourAngleDegrees - travel }, meridianLimit)
}

// Same conservative policy as Vela rig-model/assess.ts (step 25): one p90 goto
// landing offset per blind degree, not a measured sky-error slope (step 3, n=30).
export const blindErrorArcminPerDegree = 7.02 / 60
// Largest recorded abort overshoot, 15915.2 arcsec (step 3, home-abort, n=1).
// The sparse profile is a conservative fallback, not a measured pointing uncertainty.
export const unknownErrorArcmin = 15915.2 / 60
// Stop after two seconds without a reading. Reserve that gap and the largest
// recorded abort travel. Step 16 goto-ok reaches 6.21 degrees/s; round up to
// 6.3, rather than using the slower 9x rate speed. Step 3 abort max is 15915.2 arcsec.
export const readingDeadlineMs = 2000
export const reactionDegrees = 6.3 * readingDeadlineMs / 1000 + 15915.2 / 3600

export function marginArcmin(error: number | null, travelDegrees: number): number {
  return (error ?? unknownErrorArcmin) + travelDegrees * blindErrorArcminPerDegree
}

export function watchRefusal(envelope: MountEnvelope, pose: MountPose, meridianLimit: number, marginDegrees: number, leadHa = 0, leadDec = 0): string | undefined {
  const from = { ...pose, hourAngleDegrees: Math.min(pose.hourAngleDegrees, pose.hourAngleDegrees + leadHa) - marginDegrees, declinationDegrees: Math.max(-90, Math.min(pose.declinationDegrees, pose.declinationDegrees + leadDec) - marginDegrees) }
  const to = { hourAngleDegrees: Math.max(pose.hourAngleDegrees, pose.hourAngleDegrees + leadHa) + marginDegrees, declinationDegrees: Math.min(90, Math.max(pose.declinationDegrees, pose.declinationDegrees + leadDec) + marginDegrees) }
  return boxRefusal(envelope, from, to, meridianLimit)
}
