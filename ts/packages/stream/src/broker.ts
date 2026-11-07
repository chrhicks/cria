import { readFileSync } from 'node:fs'
import { Effect, Schema } from 'effect'
import type { BrokerSettings } from './publisher.js'

export const BrokerLogin = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
  user: Schema.String.annotate({ description: 'Broker login for this program' }),
  passFile: Schema.String.annotate({
    description: 'A file holding only the password for that login, readable by this user alone, so the settings around it can be read without showing it',
  }),
  retryDelaySeconds: Schema.Number.annotate({
    description: 'How long to wait before logging in or storing again after the broker refuses or does not answer. A refused login fails at once, so without a wait it would be retried in a tight loop. The same 5 seconds as RestartSec of phd2.service and rig-supervisor.service',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(5))),
})

export type BrokerLogin = typeof BrokerLogin.Type

export function brokerSettings(login: BrokerLogin): BrokerSettings {
  return { servers: login.servers, user: login.user, pass: readFileSync(login.passFile, 'utf8').trim(), retryDelayMs: login.retryDelaySeconds * 1000 }
}
