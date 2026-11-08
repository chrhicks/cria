import { TimeoutError } from '@nats-io/transport-node'
import { describe, expect, it } from 'vitest'
import type { Entry } from './entry.ts'
import { openPublisher, type BrokerConnection } from './publisher.ts'

const settings = { servers: 'nats://nowhere' }
const entry: Entry = { v: 2, id: 'x', rig: 'r', run: 'r1', kind: 'k', at: 1, source: 's', body: {} }

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
    { broker: () => settings, name: 'test', log: () => {}, retryMs: 0, onConnected: connection => connected.push(connection) },
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

  it('logs the broker connecting, disconnecting and reconnecting, and not its pings', async () => {
    const broker = fakeBroker()
    const lines: string[] = []
    const publisher = openPublisher(
      { broker: () => settings, name: 'test', log: line => lines.push(line), retryMs: 0, onConnected: () => {} },
      () => Promise.resolve(broker.connection),
    )

    await publisher.store('subject', entry)
    for (const type of ['ping', 'disconnect', 'reconnecting', 'ping', 'reconnect', 'update']) {
      broker.announce(type)
      await new Promise(resolve => setTimeout(resolve))
    }

    expect(lines).toEqual(['broker connected, fake', 'broker disconnected', 'broker reconnected'])
  })

  it('sends an entry again, under the same message id, when no acknowledgement came', async () => {
    const broker = fakeBroker()
    const { publisher } = await open(broker)

    broker.failures.push(new TimeoutError())

    await publisher.store('subject', entry)

    expect(broker.sent).toEqual(['subject', 'subject'])
    expect(broker.stored).toEqual(['x'])
  })

  it('waits and sends again when the broker refuses the entry, as when the stream is missing, and says so once', async () => {
    const broker = fakeBroker()
    const lines: string[] = []
    const waits: number[] = []
    const publisher = openPublisher(
      { broker: () => settings, name: 'test', log: line => lines.push(line), retryMs: 25, onConnected: () => {} },
      () => Promise.resolve(broker.connection),
      ms => {
        waits.push(ms)

        return Promise.resolve()
      },
    )

    await publisher.store('subject', entry)
    lines.length = 0
    broker.failures.push(new Error('no responders'), new Error('no responders'), new Error('no responders'))

    await publisher.store('subject', entry)

    expect(broker.stored).toEqual(['x', 'x'])
    expect(waits).toEqual([25, 25, 25])
    expect(lines).toEqual(['stream: no responders; trying again every 0.025 s', 'stream: working again'])
  })

  it('keeps trying to reach the broker when connecting fails, and says so once', async () => {
    const broker = fakeBroker()
    const lines: string[] = []
    const attempts: number[] = []
    const publisher = openPublisher(
      { broker: () => settings, name: 'test', log: line => lines.push(line), retryMs: 25, onConnected: () => {} },
      () => {
        attempts.push(attempts.length)

        return attempts.length < 4 ? Promise.reject(new Error('authorization violation')) : Promise.resolve(broker.connection)
      },
      () => Promise.resolve(),
    )

    await publisher.store('subject', entry)

    expect(attempts).toHaveLength(4)
    expect(lines.filter(line => line.includes('authorization violation'))).toEqual(['broker connect: authorization violation; trying again every 0.025 s'])
    expect(broker.stored).toEqual(['x'])
  })

  it('keeps trying when the broker settings cannot be read yet', async () => {
    const broker = fakeBroker()
    const lines: string[] = []
    let reads = 0
    const publisher = openPublisher(
      {
        broker: () => {
          reads += 1
          if (reads < 3) throw new Error('ENOENT: no such file')

          return settings
        },
        name: 'test',
        log: line => lines.push(line),
        retryMs: 25,
        onConnected: () => {},
      },
      () => Promise.resolve(broker.connection),
      () => Promise.resolve(),
    )

    await publisher.store('subject', entry)

    expect(reads).toBe(3)
    expect(lines[0]).toBe('broker connect: ENOENT: no such file; trying again every 0.025 s')
  })

  it('drops an entry the connection refuses to take instead of throwing into the caller, and says so once', async () => {
    const broker = fakeBroker()
    const lines: string[] = []
    const refusing = { ...broker.connection, publish: () => { throw new Error('payload too large') } } as unknown as BrokerConnection
    const publisher = openPublisher(
      { broker: () => settings, name: 'test', log: line => lines.push(line), retryMs: 25, onConnected: () => {} },
      () => Promise.resolve(refusing),
      () => Promise.resolve(),
    )

    await publisher.store('subject', entry)
    expect(() => {
      publisher.publish('wire', entry)
      publisher.publish('wire', entry)
    }).not.toThrow()
    expect(lines.filter(line => line.includes('payload too large'))).toEqual(['broker publish: payload too large; entries it cannot send are dropped'])
  })

  it('does not store an entry before the broker has answered', async () => {
    const broker = fakeBroker()
    let answer = (_connection: BrokerConnection) => {}
    const publisher = openPublisher(
      { broker: () => settings, name: 'test', log: () => {}, retryMs: 0, onConnected: () => {} },
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
