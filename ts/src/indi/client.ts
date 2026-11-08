import net from 'node:net'
import { Mirror, type Property } from './mirror.ts'
import { ProblemLog } from './problems.ts'
import type { TrafficTap } from './tap.ts'
import { factsOfRequest, IndiFramer, serialize, type IndiRequest, type ProtocolProblem } from './xml.ts'

export type Values = Readonly<Record<string, number | boolean | string>>

export interface IndiClientOptions {
  readonly host: string
  readonly port: number
  readonly warn: (line: string) => void
  readonly tap?: TrafficTap
  readonly onMessage?: (device: string | undefined, text: string) => void
}

export interface IndiClient {
  readonly closed: Promise<string>
  readonly properties: (device: string) => ReadonlyArray<Property>
  readonly property: (device: string, name: string) => Property | undefined
  readonly send: (device: string, property: string, values: Values) => Promise<void>
  readonly close: () => void
}

const connection = 1

export async function connectIndi(options: IndiClientOptions): Promise<IndiClient> {
  const { tap, onMessage } = options
  const mirror = new Mirror()
  const problems = new ProblemLog({ warn: options.warn, now: Date.now })
  const framer = new IndiFramer()
  const socket = net.connect({ host: options.host, port: options.port })
  let lastError = 'connection closed'

  const transmit = (request: IndiRequest, onWritten?: (error?: Error | null) => void) => {
    const text = serialize(request)

    tap?.message({ conn: connection, dir: 'out', xml: text, facts: factsOfRequest(request) })
    socket.write(text, onWritten)
  }

  const skip = (problem: ProtocolProblem) => {
    const logged = problems.report(problem, 'skipped the element')

    if (problem.device === undefined || problem.name === undefined || !/^(def|set)\w+Vector$/.test(problem.tag)) return
    const { device, name } = problem

    mirror.apply({ type: 'del', device, name })
    if (logged) transmit({ type: 'getProperties', device, name })
  }

  const opened = new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('close', () => reject(new Error(lastError)))
  })

  const closed = new Promise<string>(resolve => {
    socket.once('close', () => {
      tap?.connection({ conn: connection, status: 'closed', error: lastError })
      resolve(lastError)
    })
  })

  socket.setNoDelay(true)
  socket.on('error', error => {
    lastError = error.message
  })
  socket.on('connect', () => {
    tap?.connection({ conn: connection, status: 'connected' })
    transmit({ type: 'getProperties' })
  })
  socket.on('data', (chunk: Buffer) => {
    const { elements, stopped } = framer.frame(chunk, tap !== undefined)

    for (const { message, problem, xml, facts } of elements) {
      tap?.message({ conn: connection, dir: 'in', xml, facts })
      if (message) {
        if (problem) problems.report(problem, 'left one element out and kept the property')
        if (message.type === 'pingRequest') transmit({ type: 'pingReply', uid: message.uid })
        else if (message.type === 'message') onMessage?.(message.device, message.text)
        else mirror.apply(message)
      } else if (problem && problem.scope === 'element') skip(problem)
    }

    if (stopped) {
      problems.report(stopped, 'dropped the connection')
      socket.destroy(new Error(`INDI protocol error: ${stopped.reason}`))
    }
  })

  await opened

  return {
    closed,
    properties: device => mirror.properties(device),
    property: (device, name) => mirror.property(device, name),
    send: async (device, property, values) => {
      const known = mirror.property(device, property)

      if (!known) throw new Error(`${device} has no property ${property}`)

      const kind = known.kind

      if (known.perm === 'ro' || kind === 'light' || kind === 'blob') throw new Error(`${device}.${property} is read-only`)

      await new Promise<void>((resolve, reject) => {
        transmit({ type: 'new', kind, device, name: property, values }, error => (error ? reject(new Error(`INDI write failed: ${error.message}`)) : resolve()))
      })
    },
    close: () => socket.destroy(),
  }
}
