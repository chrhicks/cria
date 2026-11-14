import { createConnection } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

export type Phd2Status =
  | { readonly status: 'connected' }
  | { readonly status: 'closed' }
  | { readonly status: 'failed'; readonly error: string }

interface Phd2Link {
  send: ((line: string) => void) | undefined
}

export interface Phd2 {
  readonly running: Promise<void>
  readonly send: (line: string) => boolean
}

interface Phd2Settings {
  readonly host: string
  readonly port: number
  readonly reconnectSeconds: number
}

function readUntilClosed(
  settings: Phd2Settings,
  publish: (line: string) => void,
  report: (status: Phd2Status) => void,
  signal: AbortSignal | undefined,
  link: Phd2Link,
) {
  return new Promise<void>(resolve => {
    const socket = createConnection({ host: settings.host, port: settings.port, signal })

    let unfinished = ''
    let connected = false

    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      const lines = `${unfinished}${String(chunk)}`.split(/\r?\n/)

      unfinished = lines.pop() ?? ''
      for (const line of lines) if (line !== '') publish(line)
    })
    socket.on('connect', () => {
      connected = true
      link.send = line => socket.write(`${line}\r\n`)
      report({ status: 'connected' })
    })
    socket.on('error', error => report({ status: 'failed', error: error.message }))
    socket.on('close', () => {
      link.send = undefined
      if (connected) report({ status: 'closed' })
      resolve()
    })
  })
}

export function followPhd2(
  settings: Phd2Settings,
  publish: (line: string) => void,
  report: (status: Phd2Status) => void,
  signal?: AbortSignal,
): Phd2 {
  const link: Phd2Link = { send: undefined }
  let lastStatus = ''

  const reportChange = (status: Phd2Status) => {
    const text = JSON.stringify(status)

    if (text !== lastStatus) report(status)
    lastStatus = text
  }

  async function follow() {
    while (!signal?.aborted) {
      await readUntilClosed(settings, publish, reportChange, signal, link)
      await sleep(settings.reconnectSeconds * 1000)
    }
  }

  return {
    running: follow(),
    send(line) {
      const send = link.send

      if (send === undefined) return false

      send(line)

      return true
    },
  }
}
