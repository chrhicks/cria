import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import type { BrokerSettings } from './publisher.js'

export const BrokerLogin = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
  user: Schema.String.annotate({ description: 'Broker login for this program' }),
  passFile: Schema.String.annotate({
    description: 'A file holding only the password for that login, readable by this user alone, so the settings around it can be read without showing it',
  }),
})

export type BrokerLogin = typeof BrokerLogin.Type

export function brokerSettings(login: BrokerLogin): BrokerSettings {
  return { servers: login.servers, user: login.user, pass: readFileSync(login.passFile, 'utf8').trim() }
}
