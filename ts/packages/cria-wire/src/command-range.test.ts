import { it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import { describe, expect } from 'vitest'
import { OperationRequest, commands, requestIdentity } from './index.js'

const valid = {
  capture: { exposureSeconds: 1, light: true },
  cooling: { setpointC: 0 },
  'mount-slew': { rightAscensionDegrees: 10, declinationDegrees: 10, coordinateSystem: 'j2000' },
  'mount-axis': { rateDegreesPerSecond: 1, durationSeconds: 1 },
  'mount-rotate': { rateDegreesPerSecond: 1, distanceDegrees: 1 },
  'switch-set': { channelId: 0, value: 0 },
} as const

interface Row {
  readonly kind: keyof typeof valid
  readonly parameter: string
  readonly minimum: number
  readonly maximum: number
  readonly accepted: readonly number[]
  readonly refused: readonly number[]
}

const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

const rows: readonly Row[] = [
  { kind: 'capture', parameter: 'exposureSeconds', minimum: 0.000001, maximum: 3600, accepted: [0.000001, 0.5, 3600], refused: [0, 0.0000009, 3600.001, -1, ...nonFinite] },
  { kind: 'cooling', parameter: 'setpointC', minimum: -100, maximum: 100, accepted: [-100, -20.5, 0, 100], refused: [-100.001, 100.001, ...nonFinite] },
  { kind: 'mount-slew', parameter: 'rightAscensionDegrees', minimum: 0, maximum: 359.999999999, accepted: [0, 180.25, 359.999999999], refused: [-0.001, 360, ...nonFinite] },
  { kind: 'mount-slew', parameter: 'declinationDegrees', minimum: -90, maximum: 90, accepted: [-90, 0, 45.5, 90], refused: [-90.001, 90.001, ...nonFinite] },
  { kind: 'mount-axis', parameter: 'rateDegreesPerSecond', minimum: -10, maximum: 10, accepted: [-10, -0.2507, 0.2507, 10], refused: [0, -10.001, 10.001, ...nonFinite] },
  { kind: 'mount-axis', parameter: 'durationSeconds', minimum: 0.001, maximum: 120, accepted: [0.001, 1.5, 120], refused: [0, 0.0009, 120.001, ...nonFinite] },
  { kind: 'mount-rotate', parameter: 'rateDegreesPerSecond', minimum: -10, maximum: 10, accepted: [-10, -0.2507, 0.2507, 10], refused: [0, -10.001, 10.001, ...nonFinite] },
  { kind: 'mount-rotate', parameter: 'distanceDegrees', minimum: -120, maximum: 120, accepted: [-120, -10.5, 10.5, 120], refused: [0, -120.001, 120.001, ...nonFinite] },
  { kind: 'switch-set', parameter: 'value', minimum: -1e12, maximum: 1e12, accepted: [-1e12, 0, 12.5, 1e12], refused: [-1.0000001e12, 1.0000001e12, ...nonFinite] },
]

const accepts = (kind: Row['kind'], parameter: string, value: number) =>
  Result.isSuccess(Schema.decodeUnknownResult(commands[kind].schema)({ kind, parameters: { ...valid[kind], [parameter]: value } }))

const published = (kind: Row['kind'], parameter: string) =>
  (Schema.toJsonSchemaDocument(commands[kind].parameters).schema as { readonly properties: Record<string, unknown> }).properties[parameter]

describe('float-ranged command parameters', () => {
  for (const row of rows) {
    const name = `${row.kind}.${row.parameter}`

    it(`${name} publishes its range in the JSON Schema`, () => {
      expect(published(row.kind, row.parameter)).toMatchObject({ type: 'number', minimum: row.minimum, maximum: row.maximum })
    })

    it(`${name} takes its in-range and boundary values and refuses the rest`, () => {
      expect(row.accepted.map(value => accepts(row.kind, row.parameter, value))).toEqual(row.accepted.map(() => true))
      expect(row.refused.map(value => accepts(row.kind, row.parameter, value))).toEqual(row.refused.map(() => false))
    })
  }

  it('refuses a request whose float parameter is not finite, through the whole request schema', () => {
    const request = (rateDegreesPerSecond: number) => ({
      instanceId: '00000000-0000-4000-8000-000000000001',
      requestId: 'r-1',
      deviceId: '00000000-0000-4000-8000-000000000002',
      bindingId: '00000000-0000-4000-8000-000000000003',
      expectedName: 'mount',
      kind: 'mount-axis',
      parameters: { rateDegreesPerSecond, durationSeconds: 1 },
    })
    const decodes = (value: unknown) => Result.isSuccess(Schema.decodeUnknownResult(OperationRequest)(value))

    expect([1, Number.NaN, Number.POSITIVE_INFINITY, 11].map(value => decodes(request(value)))).toEqual([true, false, false, false])
  })
})

describe('requestIdentity', () => {
  it('is the identity that OperationRequest requires, and nothing else', () => {
    const request = Schema.Struct({ ...requestIdentity })
    const identity = {
      instanceId: '00000000-0000-4000-8000-000000000001',
      requestId: 'r-1',
      deviceId: '00000000-0000-4000-8000-000000000002',
      bindingId: '00000000-0000-4000-8000-000000000003',
      expectedName: 'mount',
    }
    const decode = (value: unknown) => Result.isSuccess(Schema.decodeUnknownResult(request)(value))

    expect(Object.keys(requestIdentity).sort()).toEqual(['bindingId', 'deviceId', 'expectedName', 'instanceId', 'requestId'])
    expect(decode(identity)).toBe(true)
    expect(Object.keys(identity).map(key => decode({ ...identity, [key]: undefined }))).toEqual([false, false, false, false, false])
    expect(Result.isSuccess(Schema.decodeUnknownResult(OperationRequest)({ ...identity, kind: 'mount-park', parameters: {} }))).toBe(true)
  })
})
