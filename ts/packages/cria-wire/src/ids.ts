import { Schema } from 'effect'

const Uuid = Schema.String.pipe(Schema.check(Schema.isUUID()))
const Identifier = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/)))

export const InstanceId = Uuid.pipe(Schema.brand('InstanceId'))
export const DeviceId = Identifier.pipe(Schema.brand('DeviceId'))

export type InstanceId = typeof InstanceId.Type
export type DeviceId = typeof DeviceId.Type
