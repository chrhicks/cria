import { TimeoutError } from '@nats-io/transport-node'
import { describe, expect, it } from 'vitest'
import type { Entry } from './entry.ts'
import { openPublisher, type BrokerConnection } from './publisher.ts'

const settings = { servers: 'nats://nowhere', user: 'u', pass: 'p' }
const entry: Entry = { v: 2, id: 'x', rig: 'r', kind: 'k', at: 1, source: 's', body: {} }

function fakeBroker() {
  const sent: Array<string> = []
  const failures: Array<Error> = []
  const stored: Array<string> = []
  let announce = (_type: string) => {}

  const connection = {
    publish: (subject: string) => void sent.push(subject),
    acknowledged: (subject: string, _payload: string, messageId: string) => {
      sent.push(subject)

      const failure = failures.shift()

      if (failure) return Promise.reject(failure)

      stored.push(messageId)

      return Promise.resolve()
    },
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

  await publisher.store('subject', entry)
  broker.sent.length = 0
  broker.stored.length = 0

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

  it('sends an entry again, under the same message id, when no acknowledgement came', async () => {
    const broker = fakeBroker()
    const { publisher } = await open(broker)

    broker.failures.push(new TimeoutError())

    await publisher.store('subject', entry)

    expect(broker.sent).toEqual(['subject', 'subject'])
    expect(broker.stored).toEqual(['x'])
  })

  it('fails when the broker refuses the entry for any other reason', async () => {
    const broker = fakeBroker()
    const { publisher } = await open(broker)

    broker.failures.push(new Error('no responders'))

    await expect(publisher.store('subject', entry)).rejects.toThrow('no responders')
  })

  it('does not store an entry before the broker has answered', async () => {
    const broker = fakeBroker()
    let answer = (_connection: BrokerConnection) => {}
    const publisher = openPublisher(
      { broker: settings, name: 'test', log: () => {}, onConnected: () => {} },
      () => new Promise<BrokerConnection>(resolve => (answer = resolve)),
    )
    let done = false
    const stored = publisher.store('subject', entry).then(() => (done = true))

    publisher.publish('wire', entry)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect([done, broker.sent]).toEqual([false, []])

    answer(broker.connection)
    await stored

    expect(broker.stored).toEqual(['x'])
  })
})
