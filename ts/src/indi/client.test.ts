import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeIndi, connection } from '../../testing/fake-indi/index.ts'
import { startIndiServer, type RunningIndiServer } from '../../testing/indiserver.ts'
import { until } from '../../testing/until.ts'
import { connectIndi, type IndiClient } from './client.ts'
import type { TappedConnection, TappedMessage } from './tap.ts'

let server: RunningIndiServer

beforeAll(async () => {
  server = await startIndiServer(['indi_simulator_focus'])
})

afterAll(() => server.stop())

const focuser = 'Focuser Simulator'

async function withClient(use: (client: IndiClient) => Promise<void>, tap?: { message: (message: TappedMessage) => void; connection: (connection: TappedConnection) => void }) {
  const client = await connectIndi({ host: '127.0.0.1', port: server.port, warn: () => {}, ...(tap ? { tap } : {}) })

  try {
    await use(client)
  } finally {
    client.close()
  }
}

const valueOf = (client: IndiClient, property: string, element: string) => {
  const found = client.property(focuser, property)?.elements.get(element)

  return found?.kind === 'number' ? found.value : undefined
}

describe('INDI client against a real indiserver', () => {
  it('mirrors the definitions indiserver sends', () =>
    withClient(async client => {
      const connectionProperty = await until('the CONNECTION definition', () => client.property(focuser, 'CONNECTION'))

      expect(connectionProperty.name).toBe('CONNECTION')
      expect(client.properties(focuser).map(property => property.name)).toContain('CONNECTION')
    }))

  it('sends a command once and sees the driver finish it', async () => {
    const states: string[] = []
    const tap = {
      message: ({ dir, xml }: TappedMessage) => {
        const state = dir === 'in' && xml.startsWith('<setNumberVector') && xml.includes('name="ABS_FOCUS_POSITION"') ? /state="(\w+)"/.exec(xml)?.[1] : undefined

        if (state) states.push(state)
      },
      connection: () => {},
    }

    await withClient(async client => {
      await until('CONNECTION', () => client.property(focuser, 'CONNECTION'))
      await client.send(focuser, 'CONNECTION', { CONNECT: true })
      await until('the position', () => client.property(focuser, 'ABS_FOCUS_POSITION'))

      expect(valueOf(client, 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION')).toBe(50000)

      states.length = 0
      await client.send(focuser, 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 50100 })
      await until('the move to finish', () => states.includes('Ok') || undefined)

      expect(states.at(-1)).toBe('Ok')
      expect(valueOf(client, 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION')).toBe(50100)
    }, tap)
  })

  it('refuses to send to a property the driver never defined, without sending', () =>
    withClient(async client => {
      await expect(client.send(focuser, 'NO_SUCH_PROPERTY', { X: 1 })).rejects.toThrow('has no property NO_SUCH_PROPERTY')
    }))

  it('tells the tap about the connection and every element, in the order it saw them', async () => {
    const tapped: Array<TappedConnection | TappedMessage> = []
    const tap = { message: (message: TappedMessage) => void tapped.push(message), connection: (connection: TappedConnection) => void tapped.push(connection) }

    await withClient(async client => {
      await until('CONNECTION', () => client.property(focuser, 'CONNECTION'))
      await client.send(focuser, 'CONNECTION', { CONNECT: true })
      await until('the position', () => client.property(focuser, 'ABS_FOCUS_POSITION'))
    }, tap)

    const sent = tapped.filter((item): item is TappedMessage => 'dir' in item && item.dir === 'out')
    const received = tapped.filter((item): item is TappedMessage => 'dir' in item && item.dir === 'in')

    expect(tapped[0]).toEqual({ conn: 1, status: 'connected' })
    expect(tapped[1]).toEqual({ conn: 1, dir: 'out', xml: '<getProperties version="1.7"/>\n', facts: { type: 'other', tag: 'getProperties' } })
    expect(sent[1]?.facts).toEqual({ type: 'new', indiDevice: 'Focuser Simulator', property: 'CONNECTION', elements: { CONNECT: true } })
    expect(received.some(message => message.facts.type === 'def' && message.facts.property === 'CONNECTION')).toBe(true)
    expect(sent.map(message => message.xml.split('\n')[0])).toEqual(['<getProperties version="1.7"/>', '<newSwitchVector device="Focuser Simulator" name="CONNECTION">'])
    expect(received.some(message => message.xml.startsWith('<defSwitchVector device="Focuser Simulator" name="CONNECTION"'))).toBe(true)

    await until('the tap to see the socket close', () => tapped.some(item => 'status' in item && item.status === 'closed') || undefined)
    expect(tapped.at(-1)).toMatchObject({ conn: 1, status: 'closed' })
  })
})

describe('INDI client when the connection ends', () => {
  it('says why the connection ended, to the tap too, and keeps what it had', async () => {
    const fake = new FakeIndi()
    const closed: TappedConnection[] = []

    await fake.start()
    fake.define(connection('Fake CCD'))

    const client = await connectIndi({ host: '127.0.0.1', port: fake.port, warn: () => {}, tap: { message: () => {}, connection: item => void closed.push(item) } })

    await until('CONNECTION', () => client.property('Fake CCD', 'CONNECTION'))
    await fake.stop()

    expect(typeof (await client.closed)).toBe('string')
    expect(closed.at(-1)).toMatchObject({ status: 'closed' })
    expect(client.property('Fake CCD', 'CONNECTION')).toBeDefined()
  })

  it('fails to connect when nothing listens', async () => {
    const fake = new FakeIndi()

    await fake.start()
    const { port } = fake

    await fake.stop()
    await expect(connectIndi({ host: '127.0.0.1', port, warn: () => {} })).rejects.toThrow('ECONNREFUSED')
  })
})
