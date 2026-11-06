import { createConnection } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

export interface Phd2Settings {
  readonly host: string
  readonly port: number
  readonly reconnectSeconds: number
}

function readUntilClosed(
  settings: Phd2Settings,
  publish: (line: string) => void,
  report: (status: string) => void,
  signal: AbortSignal | undefined,
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
      report('connected')
    })
    socket.on('error', error => report(error.message))
    socket.on('close', () => {
      if (connected) report('closed')
      resolve()
    })
  })
}

export async function followPhd2(
  settings: Phd2Settings,
  publish: (line: string) => void,
  report: (status: string) => void,
  signal?: AbortSignal,
) {
  let lastStatus = ''

  const reportChange = (status: string) => {
    if (status !== lastStatus) report(status)
    lastStatus = status
  }

  while (!signal?.aborted) {
    await readUntilClosed(settings, publish, reportChange, signal)
    await sleep(settings.reconnectSeconds * 1000)
  }
}
