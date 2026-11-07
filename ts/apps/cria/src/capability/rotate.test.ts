import { describe, expect, it } from 'vitest'
import { makeCoastEstimator } from './rotate.js'

const eightTimes = { name: '8x', degreesPerSecond: 0.2507 }
const seed = 54 / 3600

describe('the coast a rotate expects', () => {
  it('starts from the measured AM5 coast, follows a twenty percent change and clamps a run of outliers to twice the seed', () => {
    const coast = makeCoastEstimator(900)

    expect(coast.expected(eightTimes)).toBeCloseTo(seed, 9)
    coast.learn(eightTimes, seed * 1.2)
    expect(coast.expected(eightTimes)).toBeCloseTo(seed * 1.2, 9)
    for (let n = 0; n < 9; n += 1) coast.learn(eightTimes, seed * 100)
    expect(coast.expected(eightTimes)).toBeCloseTo(seed * 2, 9)
  })

  it('seeds a rate it has no measurement for from the stop latency', () => {
    expect(makeCoastEstimator(900).expected({ name: '2x', degreesPerSecond: 0.01 })).toBeCloseTo(0.009, 9)
  })
})
