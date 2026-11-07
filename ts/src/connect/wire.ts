import { Schema } from 'effect'

export const protocolVersion = 6

export const deviceKinds = ['camera', 'mount', 'focuser', 'box'] as const

export type DeviceKind = (typeof deviceKinds)[number]

const Uuid = Schema.String.pipe(Schema.check(Schema.isUUID()))
const Identifier = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/)))

export const InstanceId = Uuid.pipe(Schema.brand('InstanceId'))
export const DeviceId = Identifier.pipe(Schema.brand('DeviceId'))

export type InstanceId = typeof InstanceId.Type
export type DeviceId = typeof DeviceId.Type

export const Health = Schema.Struct({ status: Schema.Literal('ok'), protocolVersion: Schema.Literal(protocolVersion), instanceId: InstanceId })

export const ConnectRequest = Schema.Struct({ deviceId: DeviceId, connected: Schema.Boolean })

export const ConnectResult = Schema.Struct({
  outcome: Schema.Literals(['confirmed', 'failed', 'uncertain']),
  message: Schema.optionalKey(Schema.String),
  setup: Schema.optionalKey(Schema.String),
})

export type ConnectRequest = typeof ConnectRequest.Type
export type ConnectResult = typeof ConnectResult.Type
