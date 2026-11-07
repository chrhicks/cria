import { connect, type NatsConnection, type Status } from '@nats-io/transport-node'
import type { Entry } from './entry.js'

export interface BrokerSettings {
  readonly servers: string
  readonly user: string
  readonly pass: string
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

export type BrokerConnection = Pick<NatsConnection, 'publish' | 'flush' | 'close' | 'getServer' | 'subscribe'> & {
  readonly status: () => AsyncIterable<Status>
}

export type ConnectToBroker = (options: BrokerSettings & { readonly name: string }) => Promise<BrokerConnection>

const connectToBroker: ConnectToBroker = options => connect({ ...options, waitOnFirstConnect: true, maxReconnectAttempts: -1 })

export function openPublisher({ broker, name, log, onConnected }: PublisherOptions, connectTo = connectToBroker): Publisher {
  let connection: BrokerConnection | undefined
  let connections = 0
  let closed = false
  let wake = () => {}
  const nextReconnect = () => new Promise<void>(resolve => (wake = resolve))

  const connected = () => {
    connections += 1
    onConnected(connections)
  }

  const ready = (async () => {
    const opened = await connectTo({ ...broker, name })

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
  })().catch((error: unknown) => log(`broker refused: ${String(error)}`))

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
      while (!closed) {
        try {
          connection?.publish(subject, JSON.stringify(entry))
          await connection?.flush()

          return
        } catch (error) {
          log(`not confirmed, sending again after the broker returns: ${String(error)}`)
          await nextReconnect()
        }
      }
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
