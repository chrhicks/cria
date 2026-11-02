import { expect, it } from 'vitest'
import type { AcceptedFix } from '@cria/wire'
import { makeBlindTravel } from '../src/capability/blind-travel.js'

const fix = (capturedAt: number, pointingErrorArcmin: number | null = 1): AcceptedFix => ({
  capturedAt, pointingErrorArcmin, rightAscensionDegrees: 0, declinationDegrees: 80,
  coordinateSystem: 'j2000', error: { scaleError: 0, hintOffsetDegrees: null },
})

it('charges travel across moves and resets at the exposure, retaining travel during the solve', () => {
  const travel = makeBlindTravel()
  travel.record({ at: 1000, ra: 359, dec: 80, pierSide: 'west' })
  travel.record({ at: 2000, ra: 9, dec: 80, pierSide: 'west' })
  expect(travel.margin(fix(1000))).toBeCloseTo(1 + 10 * 7.02 / 60)
  travel.record({ at: 3000, ra: 19, dec: 80, pierSide: 'west' })
  expect(travel.margin(fix(1000))).toBeCloseTo(1 + 20 * 7.02 / 60)
  expect(travel.margin(fix(2000))).toBeCloseTo(1 + 10 * 7.02 / 60)
  expect(travel.margin(fix(3000, 2))).toBe(2)
  expect(travel.margin(fix(3000, null))).toBeCloseTo(15915.2 / 60)
  expect(travel.margin(null)).toBeCloseTo(15915.2 / 60 + 20 * 7.02 / 60)
})

it.each([89, -89])('charges physical travel across a pier representation change at Dec %s', dec => {
  const travel = makeBlindTravel()
  travel.record({ at: 1000, ra: 100, dec, pierSide: 'west' })
  travel.record({ at: 2000, ra: 281, dec, pierSide: 'east' })
  expect(travel.margin(fix(1000))).toBeCloseTo(1 + Math.sqrt(5) * 7.02 / 60)
})

it('retains unadjusted travel when the previous pier side is unknown', () => {
  const travel = makeBlindTravel()
  travel.record({ at: 1000, ra: 100, dec: 89, pierSide: 'unknown' })
  travel.record({ at: 2000, ra: 281, dec: 89, pierSide: 'east' })
  expect(travel.margin(fix(1000))).toBeCloseTo(1 + 179 * 7.02 / 60)
})
