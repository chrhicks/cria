import { Schema } from 'effect'
import { MountEnvelope } from '@cria/wire'

export const originalEnvelope = Schema.decodeUnknownSync(MountEnvelope)({ keepOut: [
  { name: 'normal south, unmeasured', side: 'normal', minDeclinationDegrees: -90, maxDeclinationDegrees: -5, westHourAngleDegrees: 20 },
  { name: 'normal measured', side: 'normal', minDeclinationDegrees: -5, maxDeclinationDegrees: 75, eastHourAngleDegrees: -90, westHourAngleDegrees: 90 },
  { name: 'normal near pole', side: 'normal', minDeclinationDegrees: 75, maxDeclinationDegrees: 90 },
  { name: 'flipped low', side: 'flipped', minDeclinationDegrees: -90, maxDeclinationDegrees: 33 },
  { name: 'flipped east, tripod lock', side: 'flipped', minDeclinationDegrees: 33, maxDeclinationDegrees: 70, eastHourAngleDegrees: -2 },
  { name: 'flipped west, tripod leg', side: 'flipped', minDeclinationDegrees: 45, maxDeclinationDegrees: 67, westHourAngleDegrees: 5 },
  { name: 'flipped high', side: 'flipped', minDeclinationDegrees: 70, maxDeclinationDegrees: 90 },
] })

export const splitEnvelope = { ...originalEnvelope, keepOut: originalEnvelope.keepOut.flatMap(band => band.name === 'normal measured' ? [
  { ...band, maxDeclinationDegrees: 55, eastHourAngleDegrees: -91, westHourAngleDegrees: 91 },
  { ...band, name: 'normal beyond 90, measured', minDeclinationDegrees: 55, eastHourAngleDegrees: -115, westHourAngleDegrees: 115 },
] : [band]) }

export const wideEnvelope = { ...originalEnvelope, keepOut: originalEnvelope.keepOut.map(band => band.name === 'normal measured'
  ? { ...band, eastHourAngleDegrees: -115, westHourAngleDegrees: 115 } : band) }

export const measuredEnvelope = Schema.decodeUnknownSync(MountEnvelope)({
  "keepOut": [
    {
      "name": "normal south, unmeasured",
      "side": "normal",
      "minDeclinationDegrees": -90,
      "maxDeclinationDegrees": -5,
      "westHourAngleDegrees": 20
    },
    {
      "name": "normal measured",
      "side": "normal",
      "minDeclinationDegrees": -5,
      "maxDeclinationDegrees": 55,
      "eastHourAngleDegrees": -115,
      "westHourAngleDegrees": 115
    },
    {
      "name": "normal, alignment start field",
      "side": "normal",
      "minDeclinationDegrees": 55,
      "maxDeclinationDegrees": 75,
      "eastHourAngleDegrees": -155,
      "westHourAngleDegrees": 125
    },
    {
      "name": "normal near pole",
      "side": "normal",
      "minDeclinationDegrees": 75,
      "maxDeclinationDegrees": 90
    },
    {
      "name": "flipped low",
      "side": "flipped",
      "minDeclinationDegrees": -90,
      "maxDeclinationDegrees": 33
    },
    {
      "name": "flipped east, tripod lock",
      "side": "flipped",
      "minDeclinationDegrees": 33,
      "maxDeclinationDegrees": 70,
      "eastHourAngleDegrees": -2
    },
    {
      "name": "flipped west, tripod leg",
      "side": "flipped",
      "minDeclinationDegrees": 45,
      "maxDeclinationDegrees": 67,
      "westHourAngleDegrees": 5
    },
    {
      "name": "flipped high",
      "side": "flipped",
      "minDeclinationDegrees": 70,
      "maxDeclinationDegrees": 90
    }
  ]
})
