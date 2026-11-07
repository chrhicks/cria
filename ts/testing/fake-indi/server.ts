import net from 'node:net'

export type Value = number | boolean | string

export interface FakeElement {
  value: Value
  min?: number
  max?: number
  step?: number
}

export interface FakeVector {
  readonly device: string
  readonly name: string
  readonly kind: 'number' | 'switch' | 'text'
  readonly perm: 'ro' | 'rw' | 'wo'
  readonly rule?: 'OneOfMany' | 'AtMostOne'
  state: 'Idle' | 'Ok' | 'Busy' | 'Alert'
  readonly elements: Record<string, FakeElement>
}

export type Behaviour = (vector: FakeVector, values: Record<string, string>) => 'default' | 'handled'

const tags = { number: 'Number', switch: 'Switch', text: 'Text' } as const

export function connection(device: string, connected = true): FakeVector {
  return {
    device,
    name: 'CONNECTION',
    kind: 'switch',
    perm: 'rw',
    rule: 'OneOfMany',
    state: 'Ok',
    elements: { CONNECT: { value: connected }, DISCONNECT: { value: !connected } },
  }
}

export class FakeIndi {
  readonly vectors = new Map<string, FakeVector>()
  readonly received: string[] = []
  behaviour: Behaviour = () => 'default'
  port = 0
  private readonly sockets = new Set<net.Socket>()
  private server!: net.Server

  async start(port = 0): Promise<void> {
    this.server = net.createServer(socket => this.accept(socket))
    await new Promise<void>(resolve => this.server.listen(port, '127.0.0.1', resolve))
    this.port = (this.server.address() as net.AddressInfo).port
  }

  async stop(): Promise<void> {
    this.dropConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  dropConnections(): void {
    for (const socket of this.sockets) socket.destroy()
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

  update(device: string, name: string, change: { state?: FakeVector['state']; values?: Record<string, Value> }): void {
    const vector = this.vector(device, name)

    if (change.state) vector.state = change.state
    for (const [element, value] of Object.entries(change.values ?? {})) vector.elements[element]!.value = value
    this.broadcast(this.setVector(vector))
  }

  message(device: string, text: string): void {
    this.broadcast(`<message device="${escape(device)}" message="${escape(text)}"/>\n`)
  }

  private accept(socket: net.Socket) {
    let buffer = ''

    this.sockets.add(socket)
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
    const attributes = Object.fromEntries([...xml.slice(0, xml.indexOf('>') + 1).matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], unescape(match[2]!)]))

    if (xml.startsWith('<getProperties')) {
      for (const vector of this.vectors.values()) if ((!attributes.device || vector.device === attributes.device) && (!attributes.name || vector.name === attributes.name)) socket.write(this.definition(vector))

      return
    }

    if (!/^<new(Number|Switch|Text)Vector/.test(xml)) return
    const vector = this.vectors.get(`${attributes.device}.${attributes.name}`)

    if (!vector) return
    const values = Object.fromEntries([...xml.matchAll(/<one\w+ name="([^"]+)">([^<]*)<\/one\w+>/g)].map(match => [unescape(match[1]!), unescape(match[2]!.trim())]))

    if (this.behaviour(vector, values) === 'handled') return
    this.apply(vector, values)
    this.update(vector.device, vector.name, { state: 'Ok' })
  }

  private apply(vector: FakeVector, values: Record<string, string>) {
    if (vector.kind === 'switch' && vector.rule === 'OneOfMany') {
      const chosen = Object.entries(values).find(([, value]) => value === 'On')?.[0]

      if (chosen) for (const element of Object.keys(vector.elements)) vector.elements[element]!.value = element === chosen

      return
    }

    for (const [element, value] of Object.entries(values)) {
      const target = vector.elements[element]

      if (target) target.value = vector.kind === 'number' ? Number(value) : vector.kind === 'switch' ? value === 'On' : value
    }
  }

  private definition(vector: FakeVector): string {
    const tag = tags[vector.kind]
    const rule = vector.rule ? ` rule="${vector.rule}"` : ''
    const body = Object.entries(vector.elements)
      .map(([name, element]) => {
        const limits = vector.kind === 'number' ? ` format="%g" min="${element.min ?? 0}" max="${element.max ?? 0}" step="${element.step ?? 0}"` : ''

        return `  <def${tag} name="${escape(name)}" label="${escape(name)}"${limits}>${format(element.value)}</def${tag}>\n`
      })
      .join('')

    return `<def${tag}Vector device="${escape(vector.device)}" name="${escape(vector.name)}" label="${escape(vector.name)}" group="Main" state="${vector.state}" perm="${vector.perm}"${rule} timeout="60">\n${body}</def${tag}Vector>\n`
  }

  private setVector(vector: FakeVector): string {
    const tag = tags[vector.kind]
    const body = Object.entries(vector.elements)
      .map(([element, { value }]) => `  <one${tag} name="${escape(element)}">${format(value)}</one${tag}>\n`)
      .join('')

    return `<set${tag}Vector device="${escape(vector.device)}" name="${escape(vector.name)}" state="${vector.state}">\n${body}</set${tag}Vector>\n`
  }

  private broadcast(xml: string) {
    for (const socket of this.sockets) socket.write(xml)
  }
}

function format(value: Value): string {
  return escape(typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value))
}

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

function escape(text: string): string {
  return text.replace(/[&<>"']/g, character => entities[character]!)
}

function unescape(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!)
}
