import { describe, expect, it } from 'vitest'
import { gotoReach, type MountPose, type ReportedBox } from '../src/capability/goto-reach.js'
import { gotoRefusal } from '../src/capability/envelope.js'
import { splitEnvelope } from './envelope-fixtures.js'
import { recordedGotos as corpus } from './goto-fixtures.js'


const pose = (hourAngleDegrees: number, declinationDegrees: number, pierSide: MountPose['pierSide']): MountPose => ({ hourAngleDegrees, declinationDegrees, pierSide })
const contains = (box: ReportedBox, point: MountPose) => box.from.pierSide === point.pierSide
  && box.from.hourAngleDegrees <= point.hourAngleDegrees && box.to.hourAngleDegrees >= point.hourAngleDegrees
  && box.from.declinationDegrees <= point.declinationDegrees && box.to.declinationDegrees >= point.declinationDegrees

const lift = (point: MountPose, side: MountPose['pierSide']) => point.pierSide === side
  ? { ha: point.hourAngleDegrees, dec: point.declinationDegrees }
  : { ha: point.hourAngleDegrees + (side === 'west' ? -180 : 180), dec: 180 - point.declinationDegrees }

function coversSegment(from: { ha: number; dec: number }, to: { ha: number; dec: number }, boxes: ReadonlyArray<ReportedBox>, side: MountPose['pierSide']): boolean {
  const intervals: { low: number; high: number }[] = []
  for (const box of boxes) {
    const a = lift(box.from, side)
    const b = lift({ ...box.to, pierSide: box.from.pierSide }, side)
    let low = 0
    let high = 1
    for (const axis of ['ha', 'dec'] as const) {
      const min = Math.min(a[axis], b[axis])
      const max = Math.max(a[axis], b[axis])
      const delta = to[axis] - from[axis]
      if (delta === 0) {
        if (from[axis] < min || from[axis] > max) high = -1
      } else {
        const entry = (min - from[axis]) / delta
        const exit = (max - from[axis]) / delta
        low = Math.max(low, Math.min(entry, exit))
        high = Math.min(high, Math.max(entry, exit))
      }
    }
    if (low <= high) intervals.push({ low, high })
  }
  let through = 0
  for (const interval of intervals.sort((a, b) => a.low - b.low)) {
    if (interval.low > through + 1e-9) return false
    through = Math.max(through, interval.high)
  }
  return through >= 1 - 1e-9
}

it('retains the complete privacy-safe recorded flip corpus', () => {
  expect(corpus.flips).toHaveLength(23)
  expect(corpus.flips.reduce((count, flip) => count + flip.poses.length, 0)).toBe(299)
  expect(corpus.nearPoleEndpoints).toHaveLength(22)
  expect(corpus.nearPoleEndpoints.every(goto => goto.from.declinationDegrees >= goto.target.declinationDegrees)).toBe(true)
})

describe.each(corpus.flips.map((flip, index) => ({ ...flip, id: index + 1 })))('recorded flip $id', flip => {
  it.each([0, 21.4])('contains every coordinate pose and connecting segment with reserve %s', reserve => {
    const reach = gotoReach(flip.from, flip.target, 0, reserve)
    if (reach.kind === 'refused') throw new Error(reach.reason)
    for (const point of flip.poses) expect(reach.boxes.some(box => contains(box, point)), JSON.stringify(point)).toBe(true)
    for (let i = 1; i < flip.poses.length; i++)
      expect(coversSegment(lift(flip.poses[i - 1]!, flip.from.pierSide), lift(flip.poses[i]!, flip.from.pierSide), reach.boxes, flip.from.pierSide), `segment ${i}`).toBe(true)
  })
})

it.each(corpus.nearPoleEndpoints.map((goto, index) => ({ ...goto, id: index + 1 })))('contains recorded near-pole endpoint $id with the reserve retained', goto => {
  const reach = gotoReach(goto.from, goto.target, 0, 21.4)
  if (reach.kind === 'refused') throw new Error(reach.reason)
  expect(reach.boxes.some(box => contains(box, goto.observed)), JSON.stringify(goto.observed)).toBe(true)
})

it.each(['west', 'east'] as const)('allows the clear normal flip from %s', side => {
  const sign = side === 'west' ? -1 : 1
  expect(gotoRefusal(splitEnvelope, pose(sign * 40, 50, side), pose(-sign * 40, 50, side === 'west' ? 'east' : 'west'), 15, 21.4)).toBeUndefined()
})

it.each([69, 70, 80])('folds a synthetic lower-Dec approach to Dec %s without discarding reserve', dec => {
  const from = pose(-30, 50, 'west')
  const target = pose(-30, dec, 'west')
  expect(gotoRefusal(splitEnvelope, from, target, 15, 21.4)).toBeUndefined()
  const reach = gotoReach(from, target, 15, 21.4)
  if (reach.kind === 'refused') throw new Error(reach.reason)
  expect(reach.boxes.some(box => contains(box, pose(150, 180 - dec - 21.4, 'east')))).toBe(true)
})

it('still refuses a folded reserve that enters an unmeasured HA range', () => {
  expect(gotoRefusal(splitEnvelope, pose(-30, 50, 'west'), pose(-30, 85, 'west'), 15, 21.4)).toContain('115')
  expect(gotoRefusal(splitEnvelope, pose(-30, 50, 'west'), pose(-30, 85, 'west'), 15, 30)).toContain('115')
})

it('projects southern endpoint reserve onto the opposite side and checks its limits', () => {
  const from = pose(-30, -50, 'west')
  const target = pose(-30, -80, 'west')
  const reach = gotoReach(from, target, 15, 21.4)
  if (reach.kind === 'refused') throw new Error(reach.reason)
  expect(reach.boxes.some(box => contains(box, pose(150, -78.6, 'east')))).toBe(true)
  expect(gotoRefusal(splitEnvelope, from, target, 15, 21.4)).toContain('west HA limit 20')
})

it('refuses unmeasured southern flip routes and wrap routes', () => {
  expect(gotoRefusal(splitEnvelope, pose(-10, -20, 'west'), pose(10, -20, 'east'), 15, 21.4)).toContain('southern')
  expect(gotoRefusal(splitEnvelope, pose(179, 80, 'east'), pose(-179, 80, 'west'), 15, 21.4)).toContain('wrap')
})
