import { describe, expect, it } from 'vitest'
import { fieldHeightDegrees, readSolution, readStars } from './astap.ts'

describe("reading ASTAP's answers", () => {
  it('reads the centre and the whole WCS of a solved frame', () => {
    const ini = ['PLTSOLVD=T', 'CRVAL1= 3.4057643443018907E+002', 'CRVAL2= 7.9649593362056791E+001', 'CROTA2=-6.9330905668581920E+001', 'CD1_1= 1.8897956386778022E-004', 'WARNING='].join('\n')

    expect(readSolution(ini)).toEqual({ solved: true, raDegrees: 340.57643443018907, decDegrees: 79.649593362056791, wcs: { CRVAL1: 340.57643443018907, CRVAL2: 79.649593362056791, CROTA2: -69.33090566858192, CD1_1: 0.00018897956386778022 } })
  })

  it('gives the reason when the frame did not solve', () => {
    expect(readSolution('PLTSOLVD=F\nERROR=Not enough stars.')).toEqual({ solved: false, reason: 'Not enough stars.' })
    expect(readSolution('PLTSOLVD=F')).toEqual({ solved: false, reason: 'no solution' })
  })

  it('reads the star size and count of a focus measurement', () => {
    expect(readStars('HFD_MEDIAN=3.21\nSTARS=488\n')).toEqual({ measured: true, hfd: 3.21, count: 488 })
    expect(readStars('nothing')).toEqual({ measured: false, reason: 'ASTAP reported no star size' })
  })

  it('works out the field height from the frame header, for the search hint', () => {
    const height = fieldHeightDegrees(new Map<string, number>([['NAXIS2', 4176], ['XPIXSZ', 3.76], ['FOCALLEN', 400]]))

    expect(height).toBeCloseTo(2.249, 3)
    expect(fieldHeightDegrees(new Map())).toBeUndefined()
  })
})
