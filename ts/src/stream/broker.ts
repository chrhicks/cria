import { readFileSync } from 'node:fs'
import { Schema } from 'effect'

export const BrokerLogin = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
  user: Schema.String.annotate({ description: 'Broker login for this program' }),
  passFile: Schema.String.annotate({
    description: 'A file holding only the password for that login, readable by this user alone, so the settings around it can be read without showing it',
  }),
})

export type BrokerLogin = typeof BrokerLogin.Type

export interface BrokerSettings {
  readonly servers: string
  readonly user: string
  readonly pass: string
}

export const brokerSettings = (login: BrokerLogin): BrokerSettings => ({ servers: login.servers, user: login.user, pass: readFileSync(login.passFile, 'utf8').trim() })
