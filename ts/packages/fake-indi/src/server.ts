/**
 * Test support: a small INDI server written from the protocol, not from
 * Cria's code, for the cases simulators can't produce on demand: a driver that
 * never answers, refuses, ignores an abort, disappears, or loses the
 * connection. It keeps its own property state and answers requests from it.
 *
 * Deliberately independent of @cria/indi: it parses client XML with its own
 * code, so it can disagree with Cria's parser.
 */
import net from 'node:net'

export type Value = number | boolean | string

export interface FakeElement {
  value: Value
  label?: string
  min?: number
  max?: number
  step?: number
}

export interface FakeVector {
  readonly device: string
  readonly name: string
  readonly kind: 'number' | 'switch' | 'text' | 'blob'
  readonly perm: 'ro' | 'rw' | 'wo'
  readonly rule?: 'OneOfMany' | 'AnyOfMany' | 'AtMostOne'
  state: 'Idle' | 'Ok' | 'Busy' | 'Alert'
  readonly elements: Record<string, FakeElement>
}

/** Decides how the fake driver reacts to a client command; default: apply and answer Ok. */
export type Behaviour = (fake: FakeIndi, vector: FakeVector, values: Record<string, string>) => 'default' | 'handled'

const tags = { number: 'Number', switch: 'Switch', text: 'Text', blob: 'BLOB' } as const

export class FakeIndi {
  readonly vectors = new Map<string, FakeVector>()
  private readonly sockets = new Set<net.Socket>()
  private server!: net.Server
  port = 0
  behaviour: Behaviour = () => 'default'
  /** When false, getProperties is ignored: the driver has stopped answering. */
  answering = true
  readonly received: string[] = []
  private readonly cleanups: Array<() => void> = []

  async start(): Promise<void> {
    this.server = net.createServer(socket => this.accept(socket))
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as net.AddressInfo).port
  }

  async stop(): Promise<void> {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  define(vector: Omit<FakeVector, 'state'> & { state?: FakeVector['state'] }): void {
    const full: FakeVector = { state: 'Idle', ...vector }

    this.vectors.set(`${full.device}.${full.name}`, full)
    this.broadcast(this.definition(full))
  }

  vector(device: string, name: string): FakeVector {
    const found = this.vectors.get(`${device}.${name}`)

    if (!found) throw new Error(`Fake has no ${device}.${name}`)

    return found
  }

  /** Changes state and values and tells every client, as a driver's IDSet* does. */
  update(device: string, name: string, change: { state?: FakeVector['state']; values?: Record<string, Value>; message?: string }): void {
    const vector = this.vector(device, name)

    if (change.state) vector.state = change.state
    for (const [element, value] of Object.entries(change.values ?? {})) vector.elements[element]!.value = value

    const tag = tags[vector.kind]
    const body = Object.entries(vector.elements)
      .map(([element, { value }]) => `  <one${tag} name="${element}">${format(value)}</one${tag}>\n`)
      .join('')
    const message = change.message ? ` message="${change.message}"` : ''

    this.broadcast(`<set${tag}Vector device="${device}" name="${name}" state="${vector.state}"${message}>\n${body}</set${tag}Vector>\n`)
  }

  sendBlob(device: string, name: string, element: string, data: Buffer): void {
    this.broadcast(
      `<setBLOBVector device="${device}" name="${name}" state="Ok">\n  <oneBLOB name="${element}" size="${data.length}" format=".fits" len="${data.length}">\n${data.toString('base64').replace(/.{72}/g, '$&\n')}\n  </oneBLOB>\n</setBLOBVector>\n`,
    )
  }

  /** The driver process went away: indiserver deletes the device. */
  removeDevice(device: string): void {
    for (const key of [...this.vectors.keys()]) if (key.startsWith(`${device}.`)) this.vectors.delete(key)
    this.broadcast(`<delProperty device="${device}"/>\n`)
  }

  onStop(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  dropConnections(): void {
    for (const socket of this.sockets) socket.destroy()
  }

  private accept(socket: net.Socket) {
    this.sockets.add(socket)
    let buffer = ''

    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => this.sockets.delete(socket))
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')

      while (true) {
        const element = /^\s*(<(\w+)[^>]*\/>|<(\w+)[^>]*>[\s\S]*?<\/\3>)/.exec(buffer)

        if (!element) break
        buffer = buffer.slice(element[0].length)
        this.handle(socket, element[1]!)
      }
    })
  }

  private handle(socket: net.Socket, xml: string) {
    this.received.push(xml)
    const openingTag = xml.slice(0, xml.indexOf('>') + 1)
    const attributes = Object.fromEntries([...openingTag.matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], match[2]]))

    if (xml.startsWith('<getProperties')) {
      if (!this.answering) return
      for (const vector of this.vectors.values()) {
        if (attributes.device && attributes.device !== vector.device) continue
        if (attributes.name && attributes.name !== vector.name) continue
        socket.write(this.definition(vector))
      }

      return
    }

    if (xml.startsWith('<pingRequest')) {
      socket.write(`<pingReply uid="${attributes.uid}"/>\n`)

      return
    }

    const command = /^<new(Number|Switch|Text)Vector/.exec(xml)

    if (!command) return
    const vector = this.vectors.get(`${attributes.device}.${attributes.name}`)

    if (!vector) return
    const values = Object.fromEntries([...xml.matchAll(/<one\w+ name="([^"]+)">([^<]*)<\/one\w+>/g)].map(match => [match[1]!, match[2]!.trim()]))

    if (this.behaviour(this, vector, values) === 'handled') return
    this.apply(vector, values)
    this.update(vector.device, vector.name, { state: 'Ok' })
  }

  /** What a well-behaved driver does with a client's new values. */
  apply(vector: FakeVector, values: Record<string, string>): void {
    if (vector.kind === 'switch' && vector.rule === 'OneOfMany') {
      const chosen = Object.entries(values).find(([, value]) => value === 'On')?.[0]

      if (chosen) for (const element of Object.keys(vector.elements)) vector.elements[element]!.value = element === chosen
      return
    }

    for (const [element, value] of Object.entries(values)) {
      const target = vector.elements[element]

      if (!target) continue
      target.value = vector.kind === 'number' ? Number(value) : vector.kind === 'switch' ? value === 'On' : value
    }
  }

  private definition(vector: FakeVector): string {
    const tag = tags[vector.kind]
    const rule = vector.rule ? ` rule="${vector.rule}"` : ''
    const body = Object.entries(vector.elements)
      .map(([name, element]) => {
        const limits = vector.kind === 'number' ? ` format="%g" min="${element.min ?? 0}" max="${element.max ?? 0}" step="${element.step ?? 0}"` : ''

        return vector.kind === 'blob'
          ? `  <defBLOB name="${name}" label="${name}"/>\n`
          : `  <def${tag} name="${name}" label="${element.label ?? name}"${limits}>${format(element.value)}</def${tag}>\n`
      })
      .join('')

    return `<def${tag}Vector device="${vector.device}" name="${vector.name}" label="${vector.name}" group="Main" state="${vector.state}" perm="${vector.perm}"${rule} timeout="60">\n${body}</def${tag}Vector>\n`
  }

  private broadcast(xml: string) {
    for (const socket of this.sockets) socket.write(xml)
  }
}

function format(value: Value): string {
  return typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value)
}
