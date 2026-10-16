import { Schema } from 'effect'

const Uuid = Schema.String.pipe(Schema.check(Schema.isUUID()))
const Identifier = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/)))

export const InstanceId = Uuid.pipe(Schema.brand('InstanceId'))
export const OperationId = Uuid.pipe(Schema.brand('OperationId'))
export const ImageId = Uuid.pipe(Schema.brand('ImageId'))
export const BindingId = Uuid.pipe(Schema.brand('BindingId'))
export const DeviceId = Identifier.pipe(Schema.brand('DeviceId'))
export const FailureDomain = Identifier.pipe(Schema.brand('FailureDomain'))
export const RequestId = Schema.String.pipe(
  Schema.check(Schema.isBetweenLength(1, 128), Schema.isPattern(/^[^\u0000-\u001f\u007f-\u009f]+$/)),
  Schema.brand('RequestId'),
)

export type InstanceId = typeof InstanceId.Type
export type OperationId = typeof OperationId.Type
export type ImageId = typeof ImageId.Type
export type BindingId = typeof BindingId.Type
export type DeviceId = typeof DeviceId.Type
export type FailureDomain = typeof FailureDomain.Type
export type RequestId = typeof RequestId.Type
