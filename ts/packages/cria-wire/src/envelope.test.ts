import { Schema } from 'effect'
import { expect, it } from 'vitest'
import { MountEnvelope, protocolVersion } from './index.js'

const band = { name: 'west', side: 'normal', minDeclinationDegrees: -90, maxDeclinationDegrees: 90, westHourAngleDegrees: 20 }
const decode = (input: unknown) => Schema.decodeUnknownSync(MountEnvelope)(input, { onExcessProperty: 'error' })

it('adds an envelope schema within protocol 5, including the reserved horizon and meridian fields', () => {
  const value = { keepOut: [band], horizon: [{ azimuthDegrees: 0, altitudeDegrees: 10 }], meridianLimitDegrees: 15 }

  expect(protocolVersion).toBe(5)
  expect(decode(value)).toEqual(value)
})

it.each([
  { ...band, minDeclinationDegrees: 91 },
  { ...band, minDeclinationDegrees: 80, maxDeclinationDegrees: 60 },
  { ...band, eastHourAngleDegrees: 30 },
  { ...band, westHourAngleDegrees: Infinity },
  { ...band, side: 'unknown' },
])('refuses an invalid keep-out band %j', invalid => {
  expect(() => decode({ keepOut: [invalid] })).toThrow()
})
