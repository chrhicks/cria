import { Result, Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { ErrorBody, Operation, OperationRequest, type HaltKind } from './index.js'

const strict = { onExcessProperty: 'error' } as const
const decodes = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value, strict))

const id = '00000000-0000-4000-8000-000000000001'
const operation = {
  id,
  instanceId: id,
  requestId: 'r1',
  deviceId: 'focuser',
  kind: 'focuser-move',
  parameters: { position: 100},
  acceptedAt: 1,
  startedAt: 1,
  settledAt: 2,
  state: 'settled',
  outcome: { kind: 'confirmed', value: { values: { position: 100 }, image: null } },
}

describe('protocol 5 contract', () => {
  it('accepts a settled operation with a confirmed outcome', () => {
    expect(decodes(Operation, operation)).toBe(true)
  })

  it('refuses protocol 4 vocabulary and reasons outside the closed lists', () => {
    expect(decodes(Operation, { ...operation, outcome: { kind: 'succeeded', value: { values: {}, image: null } } })).toBe(false)
    expect(decodes(Operation, { ...operation, status: 'succeeded' })).toBe(false)
    expect(decodes(Operation, { ...operation, outcome: { kind: 'uncertain', reason: 'maybe', message: '' } })).toBe(false)
    expect(decodes(Operation, { ...operation, parameters: { position: 0} })).toBe(false)
  })

  it('refuses progress fields Cria never varied', () => {
    const { settledAt: _, outcome: _outcome, ...accepted } = operation
    const running = { ...accepted, state: 'running', progress: { phase: 'exposing', elapsedSeconds: 2 } }
    const earlier = { ...running.progress, acknowledged: true, observation: 'current', message: null }

    expect(decodes(Operation, running)).toBe(true)
    expect(decodes(Operation, { ...running, progress: earlier })).toBe(false)
    expect(decodes(Operation, { ...running, progress: { ...running.progress, phase: 'waiting' } })).toBe(false)
  })

  it('carries per state only the fields that state has, and only a halt waits', () => {
    const { startedAt: _, settledAt: _settledAt, outcome: _outcome, ...accepted } = operation
    const stop = { ...accepted, deviceId: 'mount', kind: 'mount-stop', parameters: {} }

    expect(decodes(Operation, { ...stop, state: 'waiting' })).toBe(true)
    expect(decodes(Operation, { ...accepted, state: 'waiting' })).toBe(false)
    expect(decodes(Operation, { ...stop, state: 'waiting', startedAt: 1 })).toBe(false)
    expect(decodes(Operation, { ...stop, state: 'running', startedAt: 1, progress: { phase: 'preparing', elapsedSeconds: null }, outcome: null })).toBe(false)
    expect(decodes(Operation, { ...operation, progress: { phase: 'retaining', elapsedSeconds: null } })).toBe(false)
    expectTypeOf<Extract<Operation, { state: 'waiting' }>['kind']>().toEqualTypeOf<HaltKind>()
    expectTypeOf<'outcome' extends keyof Extract<Operation, { state: 'running' }> ? true : false>().toEqualTypeOf<false>()
  })

  it('takes a slew only in a frame a mount reports', () => {
    const slew = (coordinateSystem: string) => ({
      instanceId: id,
      requestId: 'r2',
      deviceId: 'mount',
      kind: 'mount-slew',
      parameters: { rightAscensionDegrees: 10, declinationDegrees: 20, coordinateSystem },
    })

    expect(decodes(OperationRequest, slew('topocentric'))).toBe(true)
    expect(decodes(OperationRequest, slew('j2000'))).toBe(true)
    expect(decodes(OperationRequest, slew('j2050'))).toBe(false)
    expect(decodes(OperationRequest, slew('b1950'))).toBe(false)
  })

  it('refuses identifiers that are not IDs', () => {
    expect(decodes(ErrorBody, { error: { code: 'not-found', message: 'No such operation' }, instanceId: 'cria' })).toBe(false)
    expect(decodes(Operation, { ...operation, deviceId: 'zwo eaf' })).toBe(false)
    expect(decodes(Operation, { ...operation, id: 'op-1' })).toBe(false)
  })

  it('takes only the error codes Cria emits', () => {
    expect(decodes(ErrorBody, { error: { code: 'device-busy', message: 'The device is running another operation' }, instanceId: id })).toBe(true)
    expect(decodes(ErrorBody, { error: { code: 'busy', message: 'The device is running another operation' }, instanceId: id })).toBe(false)
  })
})
