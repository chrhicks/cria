import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { ConnectRequest, ConnectResult, Health, protocolVersion } from './index.js'

const strict = { onExcessProperty: 'error' } as const
const decodes = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value, strict))

const instanceId = '00000000-0000-4000-8000-000000000001'

describe('protocol 6', () => {
  it('is version 6', () => {
    expect(protocolVersion).toBe(6)
  })

  it('accepts health with the current version only', () => {
    expect(decodes(Health, { status: 'ok', protocolVersion: 6, instanceId })).toBe(true)
    expect(decodes(Health, { status: 'ok', protocolVersion: 5, instanceId })).toBe(false)
    expect(decodes(Health, { status: 'ok', protocolVersion: 6, instanceId, commandsEnabled: true })).toBe(false)
  })

  it('accepts a connect request with a device id and a boolean, and nothing else', () => {
    expect(decodes(ConnectRequest, { deviceId: 'mount', connected: true })).toBe(true)
    expect(decodes(ConnectRequest, { deviceId: 'a b', connected: true })).toBe(false)
    expect(decodes(ConnectRequest, { deviceId: 'mount', connected: 'yes' })).toBe(false)
    expect(decodes(ConnectRequest, { deviceId: 'mount', connected: true, requestId: 'r' })).toBe(false)
  })

  it('accepts the three outcomes, with the message and setup optional', () => {
    expect(decodes(ConnectResult, { outcome: 'confirmed' })).toBe(true)
    expect(decodes(ConnectResult, { outcome: 'uncertain', message: 'm', setup: 's' })).toBe(true)
    expect(decodes(ConnectResult, { outcome: 'done' })).toBe(false)
  })
})
