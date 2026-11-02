import { expect, it } from 'vitest'
import { axisDelta } from '../src/capability/mount-axes.js'

it.each([{ dec: 89, travel: -2 }, { dec: -89, travel: 2 }])('keeps the physical direction across a representation change at Dec $dec', ({ dec, travel }) => {
  expect(axisDelta({ from: { ra: 100, dec, pierSide: 'west' }, to: { ra: 281, dec, pierSide: 'east' } })).toEqual({ raDegrees: 1, decDegrees: travel })
})

it('treats a pole representation change as zero travel', () => {
  expect(axisDelta({ from: { ra: 90, dec: 90, pierSide: 'east' }, to: { ra: 270, dec: 90, pierSide: 'west' } })).toEqual({ raDegrees: 0, decDegrees: 0 })
})
