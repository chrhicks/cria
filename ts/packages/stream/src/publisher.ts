import { connect, type NatsConnection } from '@nats-io/transport-node'
import type { Entry } from './entry.js'

export interface BrokerSettings {
  readonly servers: string
  readonly user: string
  readonly pass: string
}

export interface Publisher {
  readonly ready: Promise<void>
  readonly publish: (subject: string, entry: Entry) => void
  readonly flush: () => Promise<void>
  readonly close: () => Promise<void>
}

export interface PublisherOptions {
  readonly broker: BrokerSettings
  readonly name: string
  readonly log: (line: string) => void
  readonly onConnected: (connection: number) => void
}

export function openPublisher({ broker, name, log, onConnected }: PublisherOptions): Publisher {
  let connection: NatsConnection | undefined
  let connections = 0
  let closed = false

  const connected = () => {
    connections += 1
    onConnected(connections)
  }

  const ready = (async () => {
    const opened = await connect({ ...broker, name, waitOnFirstConnect: true, maxReconnectAttempts: -1 })

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
        if (status.type === 'reconnect') connected()
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
    flush: () => connection?.flush() ?? Promise.resolve(),
    async close() {
      closed = true
      await connection?.close()
    },
  }
}
