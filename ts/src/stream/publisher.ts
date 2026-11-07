import { jetstream } from '@nats-io/jetstream'
import { connect, type NatsConnection, type Status } from '@nats-io/transport-node'
import type { Entry } from './entry.ts'

export interface BrokerSettings {
  readonly servers: string
  readonly user: string
  readonly pass: string
  readonly retryDelayMs: number
}

export interface Publisher {
  readonly ready: Promise<void>
  readonly publish: (subject: string, entry: Entry) => void
  readonly publishConfirmed: (subject: string, entry: Entry) => Promise<void>
  readonly listen: (subject: string, onMessage: () => void) => void
  readonly close: () => Promise<void>
}

export interface PublisherOptions {
  readonly broker: BrokerSettings
  readonly name: string
  readonly log: (line: string) => void
  readonly onConnected: (connection: number) => void
}

export type BrokerConnection = Pick<NatsConnection, 'publish' | 'close' | 'getServer' | 'subscribe'> & {
  readonly status: () => AsyncIterable<Status>
  readonly store: (subject: string, payload: string, messageId: string) => Promise<unknown>
}

export type ConnectToBroker = (options: Omit<BrokerSettings, 'retryDelayMs'> & { readonly name: string }) => Promise<BrokerConnection>

const connectToBroker: ConnectToBroker = async options => {
  const connection = await connect({ ...options, waitOnFirstConnect: true, maxReconnectAttempts: -1 })
  const stream = jetstream(connection)

  return {
    publish: (subject, payload) => connection.publish(subject, payload),
    close: () => connection.close(),
    getServer: () => connection.getServer(),
    subscribe: (subject, subscriptionOptions) => connection.subscribe(subject, subscriptionOptions),
    status: () => connection.status(),
    store: (subject, payload, messageId) => stream.publish(subject, payload, { msgID: messageId }),
  }
}

export function openPublisher({ broker: { retryDelayMs, ...login }, name, log, onConnected }: PublisherOptions, connectTo = connectToBroker): Publisher {
  let connection: BrokerConnection | undefined
  let connections = 0
  let closed = false
  const sleepers = new Set<() => void>()
  const wake = () => {
    for (const resolve of sleepers) resolve()
    sleepers.clear()
  }
  const nextWake = () => new Promise<void>(resolve => sleepers.add(resolve))
  const wait = () => Promise.race([nextWake(), new Promise<void>(resolve => setTimeout(resolve, retryDelayMs))])

  const connected = () => {
    connections += 1
    onConnected(connections)
  }

  const ready = (async () => {
    while (!closed) {
      try {
        const opened = await connectTo({ ...login, name })

        if (closed) {
          await opened.close()
          return
        }

        connection = opened
        log(`broker connected, ${opened.getServer()}`)
        connected()

        void (async () => {
          for await (const status of opened.status()) {
            log(`broker ${status.type}`)
            if (status.type === 'reconnect') {
              connected()
              wake()
            }
          }
        })()

        return
      } catch (error) {
        log(`broker refused, trying again: ${String(error)}`)
        await wait()
      }
    }
  })()

  return {
    ready,
    publish(subject, entry) {
      try {
        connection?.publish(subject, JSON.stringify(entry))
      } catch (error) {
        log(`publish failed: ${String(error)}`)
      }
    },
    async publishConfirmed(subject, entry) {
      await ready

      while (!closed && connection !== undefined) {
        try {
          await connection.store(subject, JSON.stringify(entry), entry.id)

          return
        } catch (error) {
          log(`not stored, sending again: ${String(error)}`)
          await wait()
        }
      }

      throw new Error('the publisher closed before the stream stored the entry')
    },
    listen(subject, onMessage) {
      void ready.then(() => connection?.subscribe(subject, { callback: error => (error ? log(`listening on ${subject} failed: ${String(error)}`) : onMessage()) }))
    },
    async close() {
      closed = true
      wake()
      await connection?.close()
    },
  }
}
