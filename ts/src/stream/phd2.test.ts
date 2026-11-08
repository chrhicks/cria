import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { followPhd2, type Phd2Status } from './phd2.ts'

const version = '{"Event":"Version","PHDVersion":"2.6.14"}'
const appState = '{"Event":"AppState","State":"Stopped"}'

const reconnectSeconds = 0.01
let stop: AbortController
let server: Server

afterEach(async () => {
  stop.abort()
  if (server.listening) await new Promise(resolve => server.close(resolve))
})

function listen(onClient: (client: Socket, written: Array<string>) => void) {
  const written: Array<string> = []

  server = createServer(client => {
    client.setEncoding('utf8').on('data', data => written.push(String(data)))
    client.on('error', () => undefined)
    onClient(client, written)
  })

  return new Promise<{ port: number; written: Array<string> }>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, written }))
  })
}

function follow(port: number) {
  const lines: Array<string> = []
  const statuses: Array<Phd2Status> = []

  stop = new AbortController()
  const done = followPhd2({ host: '127.0.0.1', port, reconnectSeconds }, line => lines.push(line), status => statuses.push(status), stop.signal)

  return { lines, statuses, done }
}

async function until(condition: () => boolean) {
  while (!condition()) await new Promise(resolve => setTimeout(resolve, 5))
}

describe('following PHD2', () => {
  it('publishes each event as one raw line and writes nothing back', async () => {
    const { port, written } = await listen(client => {
      client.write(`${version}\r\n${appState.slice(0, 10)}`)
      setTimeout(() => client.write(`${appState.slice(10)}\r\n\r\n`), 10)
    })
    const { lines, done } = follow(port)

    await until(() => lines.length === 2)
    stop.abort()
    await done

    expect(lines).toEqual([version, appState])
    expect(written).toEqual([])
  })

  it('reconnects after PHD2 goes away', async () => {
    let clients = 0
    const { port } = await listen(client => {
      clients += 1
      client.end(`${version}\r\n`)
    })
    const { lines, statuses, done } = follow(port)

    await until(() => lines.length >= 2)
    stop.abort()
    await done

    expect(clients).toBeGreaterThanOrEqual(2)
    expect(statuses.slice(0, 3)).toEqual([{ status: 'connected' }, { status: 'closed' }, { status: 'connected' }])
  })

  it('keeps trying while PHD2 is down and reports the failure once', async () => {
    const { port } = await listen(() => undefined)

    await new Promise(resolve => server.close(resolve))
    const { statuses, done } = follow(port)

    await until(() => statuses.length >= 1)
    await new Promise(resolve => setTimeout(resolve, 50))
    stop.abort()
    await done

    expect(statuses.filter(status => status.status === 'failed' && status.error.includes('ECONNREFUSED'))).toHaveLength(1)
  })
})
