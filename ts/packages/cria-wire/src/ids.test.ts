import { Result, Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { DeviceId, InstanceId } from './index.js'

const decodes = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value))

describe('identifiers', () => {
  it('keeps each kind of ID apart', () => {
    expectTypeOf<DeviceId>().not.toExtend<InstanceId>()
    expectTypeOf<string>().not.toExtend<DeviceId>()
  })

  it('refuses a value outside its pattern', () => {
    expect([decodes(InstanceId, '00000000-0000-4000-8000-000000000001'), decodes(InstanceId, 'x')]).toEqual([true, false])
    expect([decodes(DeviceId, 'pegasus-ppba'), decodes(DeviceId, ''), decodes(DeviceId, 'a b')]).toEqual([true, false, false])
  })
})
