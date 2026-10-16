import { Result, Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { BindingId, DeviceId, FailureDomain, ImageId, InstanceId, OperationId, RequestId } from './index.js'

const id = '00000000-0000-4000-8000-000000000001'
const decodes = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value))

describe('identifiers', () => {
  it('keeps each kind of ID apart', () => {
    expectTypeOf<OperationId>().not.toExtend<ImageId>()
    expectTypeOf<ImageId>().not.toExtend<OperationId>()
    expectTypeOf<InstanceId>().not.toExtend<BindingId>()
    expectTypeOf<DeviceId>().not.toExtend<FailureDomain>()
    expectTypeOf<string>().not.toExtend<RequestId>()
    expectTypeOf<OperationId>().toExtend<string>()
  })

  it('refuses a value outside its pattern', () => {
    expect([decodes(ImageId, id), decodes(ImageId, ''), decodes(ImageId, 'image-1')]).toEqual([true, false, false])
    expect([decodes(FailureDomain, 'pegasus-ppba'), decodes(FailureDomain, ''), decodes(FailureDomain, 'a b')]).toEqual([true, false, false])
    expect([decodes(RequestId, 'startup-1'), decodes(RequestId, ''), decodes(RequestId, 'a\nb')]).toEqual([true, false, false])
  })
})
