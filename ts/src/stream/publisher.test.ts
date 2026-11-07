import { describe, expect, it } from 'vitest'
import type { Entry } from './entry.ts'
import { openPublisher, type BrokerConnection } from './publisher.ts'

const settings = { servers: 'nats://nowhere', user: 'u', pass: 'p', retryDelayMs: 1 }
const entry: Entry = { v: 1, id: 'x', rig: 'r', kind: 'k', at: 1, source: 's', body: {} }

function fakeBroker() {
  const sent: Array<string> = []
  const failures: Array<Error> = []
  const stored: Array<string> = []
  let announce = (_type: string) => {}

  const connection = {
    publish: (subject: string) => void sent.push(subject),
    store: (subject: string, _payload: string, messageId: string) => {
      sent.push(subject)

      const failure = failures.shift()

      if (failure) return Promise.reject(failure)

      stored.push(messageId)

      return Promise.resolve()
    },
    close: () => Promise.resolve(),
    getServer: () => 'fake',
    status: async function* () {
      while (true) yield { type: await new Promise<string>(resolve => (announce = resolve)) }
    },
  } as unknown as BrokerConnection

  return { connection, sent, stored, failures, announce: (type: string) => announce(type) }
}

async function open(broker: ReturnType<typeof fakeBroker>) {
  const connected: Array<number> = []
  const publisher = openPublisher(
    { broker: settings, name: 'test', log: () => {}, onConnected: connection => connected.push(connection) },
    () => Promise.resolve(broker.connection),
  )

  await publisher.ready
  await new Promise(resolve => setTimeout(resolve))

  return { publisher, connected }
}

describe('publisher', () => {
  it('counts each connection to the broker', async () => {
    const broker = fakeBroker()
    const { connected } = await open(broker)

    broker.announce('reconnect')
    await new Promise(resolve => setTimeout(resolve))

    expect(connected).toEqual([1, 2])
  })

  it('sends an unstored entry again, under the same message id, without failing', async () => {
    const broker = fakeBroker()
    const { publisher } = await open(broker)

    broker.failures.push(new Error('connection disconnected'))

    await publisher.publishConfirmed('subject', entry)

    expect(broker.sent).toEqual(['subject', 'subject'])
    expect(broker.stored).toEqual(['x'])
  })

  it('does not report an entry stored until the broker is reachable and acknowledges it', async () => {
    const broker = fakeBroker()
    const attempts: Array<string> = []
    let allowed = false
    const publisher = openPublisher(
      { broker: settings, name: 'test', log: () => {}, onConnected: () => {} },
      options => {
        attempts.push(options.user)

        return allowed ? Promise.resolve(broker.connection) : Promise.reject(new Error('authorization violation'))
      },
    )
    let done = false
    const confirmed = publisher.publishConfirmed('subject', entry).then(() => (done = true))

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(done).toBe(false)
    expect(broker.stored).toEqual([])
    expect(attempts.length).toBeGreaterThan(1)

    allowed = true
    await confirmed

    expect(broker.stored).toEqual(['x'])
  })

  it('fails a confirmed publish when closed before the entry is stored', async () => {
    const publisher = openPublisher(
      { broker: settings, name: 'test', log: () => {}, onConnected: () => {} },
      () => Promise.reject(new Error('authorization violation')),
    )
    const confirmed = publisher.publishConfirmed('subject', entry)

    await publisher.close()

    await expect(confirmed).rejects.toThrow('closed')
  })

  it('never throws from a plain publish', async () => {
    const broker = fakeBroker()
    const { publisher } = await open(broker)

    broker.connection.publish = () => {
      throw new Error('refused')
    }

    expect(() => publisher.publish('subject', entry)).not.toThrow()
  })
})
