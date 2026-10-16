import { Result, Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Device, ErrorBody, Operation, OperationRequest, State, type HaltKind } from './index.js'

const strict = { onExcessProperty: 'error' } as const
const decodes = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value, strict))

const id = '00000000-0000-4000-8000-000000000001'
const operation = {
  id,
  instanceId: id,
  requestId: 'r1',
  deviceId: 'focuser',
  bindingId: id,
  expectedName: 'ZWO EAF',
  failureDomain: 'zwo-eaf',
  kind: 'focuser-move',
  parameters: { position: 100, minPosition: 1, maxPosition: 200 },
  acceptedAt: 1,
  startedAt: 1,
  settledAt: 2,
  state: 'settled',
  outcome: { kind: 'confirmed', value: { values: { position: 100 }, image: null } },
  recovery: null,
}

describe('protocol 5 contract', () => {
  it('accepts a settled operation with a confirmed outcome', () => {
    expect(decodes(Operation, operation)).toBe(true)
  })

  it('refuses protocol 4 vocabulary and reasons outside the closed lists', () => {
    expect(decodes(Operation, { ...operation, outcome: { kind: 'succeeded', value: { values: {}, image: null } } })).toBe(false)
    expect(decodes(Operation, { ...operation, status: 'succeeded' })).toBe(false)
    expect(decodes(Operation, { ...operation, outcome: { kind: 'uncertain', reason: 'maybe', message: '' } })).toBe(false)
    expect(decodes(Operation, { ...operation, parameters: { position: 0, minPosition: 1, maxPosition: 2 } })).toBe(false)
  })

  it('refuses progress fields Cria never varied', () => {
    const { settledAt: _, outcome: _outcome, recovery: _recovery, ...accepted } = operation
    const running = { ...accepted, state: 'running', progress: { phase: 'exposing', elapsedSeconds: 2 } }
    const earlier = { ...running.progress, acknowledged: true, observation: 'current', message: null }

    expect(decodes(Operation, running)).toBe(true)
    expect(decodes(Operation, { ...running, progress: earlier })).toBe(false)
    expect(decodes(Operation, { ...running, progress: { ...running.progress, phase: 'waiting' } })).toBe(false)
  })

  it('carries per state only the fields that state has, and only a halt waits', () => {
    const { startedAt: _, settledAt: _settledAt, outcome: _outcome, recovery: _recovery, ...accepted } = operation
    const stop = { ...accepted, deviceId: 'mount', kind: 'mount-stop', parameters: {} }

    expect(decodes(Operation, { ...stop, state: 'waiting' })).toBe(true)
    expect(decodes(Operation, { ...accepted, state: 'waiting' })).toBe(false)
    expect(decodes(Operation, { ...stop, state: 'waiting', startedAt: 1 })).toBe(false)
    expect(decodes(Operation, { ...stop, state: 'running', startedAt: 1, progress: { phase: 'preparing', elapsedSeconds: null }, outcome: null })).toBe(false)
    expect(decodes(Operation, { ...operation, progress: { phase: 'retaining', elapsedSeconds: null } })).toBe(false)
    expectTypeOf<Extract<Operation, { state: 'waiting' }>['kind']>().toEqualTypeOf<HaltKind>()
    expectTypeOf<'outcome' extends keyof Extract<Operation, { state: 'running' }> ? true : false>().toEqualTypeOf<false>()
  })

  it('records a recovery only on an uncertain operation', () => {
    const recovery = { at: 3, note: 'Chris checked the focuser' }
    const uncertain = { kind: 'uncertain', reason: 'no-acknowledgement', message: 'no answer' }

    expect(decodes(Operation, { ...operation, outcome: uncertain, recovery })).toBe(true)
    expect(decodes(Operation, { ...operation, outcome: uncertain })).toBe(true)
    expect(decodes(Operation, { ...operation, recovery })).toBe(false)
  })

  it('takes a slew only in a frame a mount reports', () => {
    const slew = (coordinateSystem: string) => ({
      instanceId: id,
      requestId: 'r2',
      deviceId: 'mount',
      bindingId: id,
      expectedName: 'Mount',
      kind: 'mount-slew',
      parameters: { rightAscensionDegrees: 10, declinationDegrees: 20, coordinateSystem },
    })

    expect(decodes(OperationRequest, slew('topocentric'))).toBe(true)
    expect(decodes(OperationRequest, slew('j2000'))).toBe(true)
    expect(decodes(OperationRequest, slew('j2050'))).toBe(false)
    expect(decodes(OperationRequest, slew('b1950'))).toBe(false)
  })

  it('refuses identifiers that are not IDs', () => {
    const state = { protocolVersion: 5, instanceId: id, sequence: 1, generatedAt: 1, commandsEnabled: true, devices: [], operations: [] }

    expect(decodes(State, state)).toBe(true)
    expect(decodes(State, { ...state, instanceId: 'cria' })).toBe(false)
    expect(decodes(ErrorBody, { error: { code: 'not-found', message: 'No such operation' }, instanceId: 'cria' })).toBe(false)
    expect(decodes(Operation, { ...operation, failureDomain: 'zwo eaf' })).toBe(false)
    expect(decodes(Operation, { ...operation, id: 'op-1' })).toBe(false)
  })

  it('takes only the error codes Cria emits', () => {
    expect(decodes(ErrorBody, { error: { code: 'device-busy', message: 'The device is running another operation' }, instanceId: id })).toBe(true)
    expect(decodes(ErrorBody, { error: { code: 'busy', message: 'The device is running another operation' }, instanceId: id })).toBe(false)
  })

  it('types readings per device kind', () => {
    const focuser = {
      id: 'focuser',
      kind: 'focuser',
      name: 'ZWO EAF',
      bindingId: id,
      failureDomain: 'zwo-eaf',
      availability: { ready: false, reason: 'refreshing', message: 'waiting for a reading after the last operation' },
      quarantine: { held: false },
      afterOperation: null,
      readings: {
        connected: { status: 'fresh', value: true, observedAt: 5 },
        name: { status: 'fresh', value: 'ZWO EAF', observedAt: 5 },
        position: { status: 'stale', value: 32749, observedAt: 4 },
        moving: { status: 'fresh', value: false, observedAt: 5 },
        temperatureC: { status: 'unavailable', reason: 'unsupported' },
        absolute: { status: 'fresh', value: true, observedAt: 5 },
        minStep: { status: 'fresh', value: 15500, observedAt: 5 },
        maxStep: { status: 'unavailable', reason: 'failed', message: 'driver gone' },
      },
    }

    expect(decodes(Device, focuser)).toBe(true)
    expect(decodes(Device, { ...focuser, readings: { ...focuser.readings, position: { status: 'fresh', value: 'far', observedAt: 5 } } })).toBe(false)
    expect(decodes(State, { protocolVersion: 4, instanceId: id, sequence: 1, generatedAt: 1, commandsEnabled: true, devices: [], operations: [] })).toBe(false)
  })
})
