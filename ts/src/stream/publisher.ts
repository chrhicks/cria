import { jetstream } from '@nats-io/jetstream'
import { connect, TimeoutError, type NatsConnection, type Status } from '@nats-io/transport-node'
import type { BrokerSettings } from './broker.ts'
import type { Entry } from './entry.ts'

export interface Publisher {
  readonly publish: (subject: string, entry: Entry) => void
  readonly store: (subject: string, entry: Entry) => Promise<void>
}

export interface PublisherOptions {
  readonly broker: BrokerSettings
  readonly name: string
  readonly log: (line: string) => void
  readonly onConnected: (connection: number) => void
}

export type BrokerConnection = Pick<NatsConnection, 'publish' | 'getServer'> & {
  readonly status: () => AsyncIterable<Status>
  readonly acknowledged: (subject: string, payload: string, messageId: string) => Promise<unknown>
}

export type ConnectToBroker = (options: BrokerSettings & { readonly name: string }) => Promise<BrokerConnection>

const connectToBroker: ConnectToBroker = async options => {
  const connection = await connect({ ...options, waitOnFirstConnect: true, maxReconnectAttempts: -1 })
  const stream = jetstream(connection)

  return {
    publish: (subject, payload) => connection.publish(subject, payload),
    getServer: () => connection.getServer(),
    status: () => connection.status(),
    acknowledged: (subject, payload, messageId) => stream.publish(subject, payload, { msgID: messageId }),
  }
}

export function openPublisher({ broker, name, log, onConnected }: PublisherOptions, connectTo: ConnectToBroker = connectToBroker): Publisher {
  let connection: BrokerConnection | undefined
  let connections = 0

  const announce = () => {
    connections += 1
    onConnected(connections)
  }

  const connecting = connectTo({ ...broker, name }).then(opened => {
    connection = opened
    log(`broker connected, ${opened.getServer()}`)
    announce()

    void (async () => {
      for await (const status of opened.status()) {
        log(`broker ${status.type}`)
        if (status.type === 'reconnect') announce()
      }
    })()

    return opened
  })

  return {
    publish: (subject, entry) => connection?.publish(subject, JSON.stringify(entry)),
    async store(subject, entry) {
      const opened = await connecting

      for (;;) {
        try {
          await opened.acknowledged(subject, JSON.stringify(entry), entry.id)

          return
        } catch (error) {
          if (!(error instanceof TimeoutError)) throw error
          log(`no acknowledgement yet, sending again: ${error.message}`)
        }
      }
    },
  }
}
