import { describe, expect, it } from 'vitest'
import type { Entry } from './entry.js'
import { openPublisher, type BrokerConnection } from './publisher.js'

const settings = { servers: 'nats://nowhere', user: 'u', pass: 'p' }
const entry: Entry = { v: 1, id: 'x', rig: 'r', kind: 'k', at: 1, source: 's', tags: [], body: {} }

function fakeBroker() {
  const sent: Array<string> = []
  const failures: Array<Error> = []
  let announce = (_type: string) => {}

  const connection = {
    publish: (subject: string) => void sent.push(subject),
    flush: () => {
      const failure = failures.shift()

      return failure ? Promise.reject(failure) : Promise.resolve()
    },
    close: () => Promise.resolve(),
    getServer: () => 'fake',
    status: async function* () {
      while (true) yield { type: await new Promise<string>(resolve => (announce = resolve)) }
    },
  } as unknown as BrokerConnection

  return { connection, sent, failures, announce: (type: string) => announce(type) }
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

  it('sends an unconfirmed entry again once the broker returns, without failing', async () => {
    const broker = fakeBroker()
    const { publisher } = await open(broker)

    broker.failures.push(new Error('connection disconnected'))

    const done = publisher.publishConfirmed('subject', entry)

    await new Promise(resolve => setTimeout(resolve))
    expect(broker.sent).toEqual(['subject'])

    broker.announce('reconnect')
    await done

    expect(broker.sent).toEqual(['subject', 'subject'])
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
