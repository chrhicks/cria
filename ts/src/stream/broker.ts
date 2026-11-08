import { Schema } from 'effect'

export const BrokerLogin = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
})

export type BrokerLogin = typeof BrokerLogin.Type

export interface BrokerSettings {
  readonly servers: string
}

export const brokerSettings = (login: BrokerLogin): BrokerSettings => ({ servers: login.servers })
