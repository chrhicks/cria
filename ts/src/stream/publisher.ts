import { jetstream } from '@nats-io/jetstream'
import { setTimeout as delay } from 'node:timers/promises'
import { connect, TimeoutError, type NatsConnection, type Status } from '@nats-io/transport-node'
import type { BrokerSettings } from './broker.ts'
import type { Entry } from './entry.ts'
import { stateLog, tryingAgain } from './retry.ts'

export interface Publisher {
  readonly publish: (subject: string, entry: Entry) => void
  readonly store: (subject: string, entry: Entry) => Promise<void>
}

export interface PublisherOptions {
  readonly broker: () => BrokerSettings
  readonly name: string
  readonly log: (line: string) => void
  readonly retryMs: number
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

const statusLine = (status: Status): string | undefined => {
  switch (status.type) {
    case 'disconnect':
      return 'broker disconnected'
    case 'reconnect':
      return 'broker reconnected'
    case 'error':
      return `broker error: ${status.error.message}`
    default:
      return undefined
  }
}

export function openPublisher(
  { broker, name, log, retryMs, onConnected }: PublisherOptions,
  connectTo: ConnectToBroker = connectToBroker,
  sleep: (ms: number) => Promise<unknown> = delay,
): Publisher {
  let connection: BrokerConnection | undefined
  let connections = 0
  const connectState = stateLog('broker connect', log, tryingAgain(retryMs))
  const publishState = stateLog('broker publish', log, 'entries it cannot send are dropped')
  const storeState = stateLog('stream', log, tryingAgain(retryMs))

  const announce = () => {
    connections += 1
    onConnected(connections)
  }

  async function connectUntilAnswered() {
    for (;;) {
      try {
        return await connectTo({ ...broker(), name })
      } catch (error) {
        connectState.failed(error)
        await sleep(retryMs)
      }
    }
  }

  const connecting = connectUntilAnswered().then(opened => {
    connection = opened
    connectState.healthy()
    log(`broker connected, ${opened.getServer()}`)
    announce()

    void (async () => {
      for await (const status of opened.status()) {
        const line = statusLine(status)

        if (line !== undefined) log(line)
        if (status.type === 'reconnect') announce()
      }
    })()

    return opened
  })

  return {
    publish: (subject, entry) => {
      try {
        connection?.publish(subject, JSON.stringify(entry))
      } catch (error) {
        publishState.failed(error)
      }
    },
    async store(subject, entry) {
      const opened = await connecting

      for (;;) {
        try {
          await opened.acknowledged(subject, JSON.stringify(entry), entry.id)
          storeState.healthy()

          return
        } catch (error) {
          storeState.failed(error)
          if (!(error instanceof TimeoutError)) await sleep(retryMs)
        }
      }
    },
  }
}
