export interface MountPose {
  readonly hourAngleDegrees: number
  readonly declinationDegrees: number
  readonly pierSide: 'east' | 'west'
}

export type Point = Pick<MountPose, 'hourAngleDegrees' | 'declinationDegrees'>

export interface ReportedBox {
  readonly from: MountPose
  readonly to: Point
}

type Reach = { readonly kind: 'path'; readonly boxes: ReadonlyArray<ReportedBox> }
  | { readonly kind: 'refused'; readonly reason: string }

interface Axes { readonly ha: number; readonly dec: number }
interface AxisBox { readonly haLow: number; readonly haHigh: number; readonly decLow: number; readonly decHigh: number }

export const gotoToleranceDegrees = 0.1

const flipMarginDegrees = 2
const intervalDegrees = 1

function bounds(from: Axes, to: Axes, margin = 0): AxisBox {
  return {
    haLow: Math.min(from.ha, to.ha) - margin, haHigh: Math.max(from.ha, to.ha) + margin,
    decLow: Math.min(from.dec, to.dec) - margin, decHigh: Math.max(from.dec, to.dec) + margin,
  }
}

function project(box: AxisBox, side: MountPose['pierSide']): ReportedBox[] {
  const other = side === 'west' ? 'east' : 'west'
  const shift = side === 'west' ? 180 : -180
  const boxes: ReportedBox[] = []
  const add = (pierSide: MountPose['pierSide'], haLow: number, haHigh: number, decLow: number, decHigh: number) => {
    boxes.push({ from: { hourAngleDegrees: haLow, declinationDegrees: decLow, pierSide }, to: { hourAngleDegrees: haHigh, declinationDegrees: decHigh } })
  }

  if (box.decLow <= 90 && box.decHigh >= -90)
    add(side, box.haLow, box.haHigh, Math.max(-90, box.decLow), Math.min(90, box.decHigh))
  if (box.decHigh > 90)
    add(other, box.haLow + shift, box.haHigh + shift, 180 - box.decHigh, 180 - Math.max(90, box.decLow))
  if (box.decLow < -90)
    add(other, box.haLow + shift, box.haHigh + shift, -180 - Math.min(-90, box.decHigh), -180 - box.decLow)
  return boxes
}

function flipBoxes(from: Axes, to: Axes, reserve: number): AxisBox[] {
  const haTravel = to.ha - from.ha
  const decTravel = to.dec - from.dec
  const diagonal = Math.min(Math.abs(haTravel), Math.abs(decTravel))
  const along = (distance: number): Axes => ({ ha: from.ha + Math.sign(haTravel) * distance, dec: from.dec + Math.sign(decTravel) * distance })
  const pieces = Math.max(1, Math.ceil(diagonal / intervalDegrees))
  const boxes: AxisBox[] = []

  for (let i = 0; i < pieces; i++)
    boxes.push(bounds(along(diagonal * i / pieces), along(diagonal * (i + 1) / pieces), flipMarginDegrees))
  boxes.push(bounds(along(diagonal), to, flipMarginDegrees))
  boxes.push(bounds(to, { ha: to.ha + Math.sign(haTravel) * reserve, dec: to.dec + Math.sign(decTravel) * reserve }, flipMarginDegrees))
  return boxes
}

export function landingSides(hourAngleDegrees: number): ReadonlyArray<MountPose['pierSide']> {
  return Math.abs(hourAngleDegrees) < 0.5 ? ['east', 'west'] : [hourAngleDegrees < 0 ? 'west' : 'east']
}

export function gotoReach(from: MountPose, to: Point, meridianLimit: number, reserveDegrees: number): Reach {
  if (![from.hourAngleDegrees, from.declinationDegrees, to.hourAngleDegrees, to.declinationDegrees, meridianLimit, reserveDegrees].every(Number.isFinite))
    return { kind: 'refused', reason: 'Envelope needs finite mount coordinates' }
  if (Math.abs(from.hourAngleDegrees) > 180 || Math.abs(to.hourAngleDegrees) > 180)
    return { kind: 'refused', reason: 'Envelope path crosses the hour-angle wrap limit' }
  if (Math.abs(from.declinationDegrees) > 90 || Math.abs(to.declinationDegrees) > 90)
    return { kind: 'refused', reason: 'Envelope path crosses the declination limit' }

  const nearPole = from.declinationDegrees >= 89 && from.declinationDegrees <= 90
  const ha = from.hourAngleDegrees
  const start: Axes = { ha: nearPole && Math.abs(ha) > 90 && Math.abs(ha) <= 90.05 + 1e-9 ? Math.sign(ha) * 90 : ha, dec: from.declinationDegrees }
  const boxes: ReportedBox[] = []

  for (const side of landingSides(to.hourAngleDegrees)) {
    const flip = side !== from.pierSide
    if (flip && (from.declinationDegrees < 0 || to.declinationDegrees < 0))
      return { kind: 'refused', reason: 'Envelope southern pier-side change is unmeasured' }
    const end: Axes = flip
      ? { ha: to.hourAngleDegrees + (from.pierSide === 'west' ? -180 : 180), dec: 180 - to.declinationDegrees }
      : { ha: to.hourAngleDegrees, dec: to.declinationDegrees }
    const beyond = { ha: end.ha + Math.sign(end.ha - start.ha) * reserveDegrees, dec: end.dec + Math.sign(end.dec - start.dec) * reserveDegrees }
    const independent = bounds(start, beyond)
    const haSlack = start.ha === end.ha ? gotoToleranceDegrees : 0
    const decSlack = start.dec === end.dec ? gotoToleranceDegrees : 0
    const physical = flip ? flipBoxes(start, end, reserveDegrees) : [{
      haLow: independent.haLow - haSlack, haHigh: independent.haHigh + haSlack,
      decLow: independent.decLow - decSlack, decHigh: independent.decHigh + decSlack,
    }]
    for (const box of physical) boxes.push(...project(box, from.pierSide))
  }
  if (boxes.some(box => box.from.hourAngleDegrees < -180 || box.to.hourAngleDegrees > 180))
    return { kind: 'refused', reason: 'Envelope path crosses the hour-angle wrap limit' }
  if (boxes.some(box => box.from.declinationDegrees < -90 || box.to.declinationDegrees > 90))
    return { kind: 'refused', reason: 'Envelope path crosses the declination limit' }
  return { kind: 'path', boxes }
}
