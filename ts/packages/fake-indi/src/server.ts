/**
 * Test support: a small INDI server written from the protocol, not from
 * Cria's code, for the cases simulators can't produce on demand: a driver that
 * never answers, refuses, ignores an abort, disappears, or loses the
 * connection. It keeps its own property state and answers requests from it.
 *
 * Deliberately independent of @cria/indi: it parses client XML with its own
 * code, so it can disagree with Cria's parser.
 *
 * Each client is a connection with its own `enableBLOB` modes: `sendBlob`
 * broadcasts to every client as it always did, `deliverBlob` sends only to
 * clients whose mode allows it and writes in chunks, so a 50 MB image is never
 * one string or one write.
 */
import net from 'node:net'

export type Value = number | boolean | string

export interface FakeElement {
  value: Value
  label?: string
  min?: number
  max?: number
  step?: number
  /** The printf-style `format` of a number, as a driver defines it. Default `%g`. */
  format?: string
}

export interface FakeVector {
  readonly device: string
  readonly name: string
  readonly kind: 'number' | 'switch' | 'text' | 'light' | 'blob'
  readonly perm: 'ro' | 'rw' | 'wo'
  readonly rule?: 'OneOfMany' | 'AnyOfMany' | 'AtMostOne'
  /** What a definition says besides the name: defaults are the property's name, `Main` and 60. */
  readonly label?: string
  readonly group?: string
  readonly timeout?: number
  state: 'Idle' | 'Ok' | 'Busy' | 'Alert'
  readonly elements: Record<string, FakeElement>
}

/** A connection to the fake. Opaque: pass it back to `FakeIndi` methods. */
export interface FakeClient {
  readonly id: number
}

/**
 * Decides how the fake driver reacts to a client command; default: apply and
 * answer Ok. `client` is the connection that wrote.
 */
export type Behaviour = (fake: FakeIndi, vector: FakeVector, values: Record<string, string>, client: FakeClient) => 'default' | 'handled'

export type BlobMode = 'Never' | 'Also' | 'Only'

export interface FakeIndiOptions {
  /** How many received elements `received` keeps, oldest dropped first. Default: all. */
  readonly receivedLimit?: number
}

const tags = { number: 'Number', switch: 'Switch', text: 'Text', light: 'Light', blob: 'BLOB' } as const

const imageChunkBytes = 54 * 1024
/** A client that sends more than this without finishing one element is cut off: the fake reads small commands only. */
const maxElementBytes = 1024 * 1024

class Client implements FakeClient {
  /** `enableBLOB` per property name; `''` is the whole device. */
  readonly blobModes = new Map<string, BlobMode>()
  private tail: Promise<void> = Promise.resolve()
  private queued = 0

  readonly id: number
  readonly socket: net.Socket

  constructor(id: number, socket: net.Socket) {
    this.id = id
    this.socket = socket
  }

  modeFor(device: string, name: string): BlobMode {
    return this.blobModes.get(`${device}.${name}`) ?? this.blobModes.get(`${device}.`) ?? 'Never'
  }

  /** Writes at once unless a large write is in progress; then after it, so elements never interleave. */
  write(data: string): void {
    if (this.queued === 0) this.socket.write(data)
    else void this.enqueue(async () => void this.socket.write(data))
  }

  /** Runs `job` with nothing else written to this client meanwhile. */
  exclusive(job: (write: (chunk: string) => Promise<void>) => Promise<void>, signal?: AbortSignal): Promise<void> {
    return this.enqueue(() => job(chunk => this.writeWithDrain(chunk, signal)))
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queued += 1
    const done = this.tail.then(work).catch(() => undefined).then(() => void (this.queued -= 1))

    this.tail = done

    return done
  }

  private async writeWithDrain(chunk: string, signal?: AbortSignal): Promise<void> {
    if (!this.socket.writable) return
    if (this.socket.write(chunk)) return
    await new Promise<void>(resolve => {
      const done = () => {
        this.socket.off('drain', done)
        this.socket.off('close', done)
        signal?.removeEventListener('abort', done)
        resolve()
      }

      this.socket.once('drain', done)
      this.socket.once('close', done)
      signal?.addEventListener('abort', done, { once: true })
    })
  }
}

export class FakeIndi {
  readonly vectors = new Map<string, FakeVector>()
  private readonly clients = new Set<Client>()
  private readonly muted = new Set<string>()
  private server!: net.Server
  private nextClient = 1
  port = 0
  behaviour: Behaviour = () => 'default'
  /** When false, getProperties is ignored: the driver has stopped answering. */
  answering = true
  /** When true, a new connection is closed at once, as when indiserver is down. */
  refusingConnections = false
  readonly received: string[] = []
  private readonly cleanups: Array<() => void> = []

  private readonly options: FakeIndiOptions

  constructor(options: FakeIndiOptions = {}) {
    this.options = options
  }

  /** Listens on `port` (0: any free port), on the loopback interface. */
  async start(port = 0): Promise<void> {
    this.server = net.createServer(socket => this.accept(socket))
    await new Promise<void>(resolve => this.server.listen(port, '127.0.0.1', resolve))
    this.port = (this.server.address() as net.AddressInfo).port
  }

  async stop(): Promise<void> {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    for (const client of this.clients) client.socket.destroy()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  /** The driver for `device` goes quiet: no unsolicited element and no answer to getProperties, until `unmute`. */
  mute(device: string): void {
    this.muted.add(device)
  }

  unmute(device: string): void {
    this.muted.delete(device)
  }

  define(vector: Omit<FakeVector, 'state'> & { state?: FakeVector['state'] }): void {
    const full: FakeVector = { state: 'Idle', ...vector }

    this.vectors.set(`${full.device}.${full.name}`, full)
    this.broadcast(this.definition(full), full.device, full.name)
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
      .map(([element, { value }]) => `  <one${tag} name="${escape(element)}">${format(value)}</one${tag}>\n`)
      .join('')
    const message = change.message ? ` message="${escape(change.message)}"` : ''

    this.broadcast(`<set${tag}Vector device="${escape(device)}" name="${escape(name)}" state="${vector.state}"${message}>\n${body}</set${tag}Vector>\n`, device, name)
  }

  sendBlob(device: string, name: string, element: string, data: Buffer): void {
    this.broadcast(
      `<setBLOBVector device="${device}" name="${name}" state="Ok">\n  <oneBLOB name="${element}" size="${data.length}" format=".fits" len="${data.length}">\n${data.toString('base64').replace(/.{72}/g, '$&\n')}\n  </oneBLOB>\n</setBLOBVector>\n`,
      device,
      undefined,
      true,
    )
  }

  /**
   * Sends an image the way indiserver does: only to clients whose `enableBLOB`
   * mode for this property is `Also` or `Only`, as base64 written in chunks that
   * wait for the socket to drain. Resolves with how many clients were sent it,
   * once the last chunk is written. Aborting `signal` stops the delivery: an
   * image not yet started is not sent, and one half written closes its
   * connection, because an element cannot be finished or withdrawn.
   */
  async deliverBlob(device: string, name: string, element: string, data: Buffer, options: { readonly format?: string; readonly signal?: AbortSignal } = {}): Promise<number> {
    const { format = '.fits', signal } = options

    if (this.muted.has(device) || signal?.aborted) return 0

    const wanting = [...this.clients].filter(client => client.modeFor(device, name) !== 'Never')
    const head = `<setBLOBVector device="${escape(device)}" name="${escape(name)}" state="Ok">\n  <oneBLOB name="${escape(element)}" size="${data.length}" format="${escape(format)}">\n`
    const tail = '\n  </oneBLOB>\n</setBLOBVector>\n'

    await Promise.all(
      wanting.map(client =>
        client.exclusive(async write => {
          if (signal?.aborted) return
          await write(head)
          for (let offset = 0; offset < data.length; offset += imageChunkBytes) {
            if (signal?.aborted) {
              client.socket.destroy()

              return
            }
            await write(data.toString('base64', offset, Math.min(data.length, offset + imageChunkBytes)).replace(/.{72}/g, '$&\n'))
          }
          if (signal?.aborted) client.socket.destroy()
          else await write(tail)
        }, signal),
      ),
    )

    return wanting.length
  }

  /** The driver process went away: indiserver deletes the device. */
  removeDevice(device: string): void {
    for (const key of [...this.vectors.keys()]) if (key.startsWith(`${device}.`)) this.vectors.delete(key)
    this.broadcast(`<delProperty device="${escape(device)}"/>\n`, device, '')
  }

  /** One property went away. */
  removeVector(device: string, name: string): void {
    this.vectors.delete(`${device}.${name}`)
    this.broadcast(`<delProperty device="${escape(device)}" name="${escape(name)}"/>\n`, device, name)
  }

  onStop(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  dropConnections(): void {
    for (const client of this.clients) client.socket.destroy()
  }

  /** Whether `client` asked for this property's images (`enableBLOB` Also or Only). */
  wantsBlobs(client: FakeClient, device: string, name: string): boolean {
    return (client as Client).modeFor(device, name) !== 'Never'
  }

  private accept(socket: net.Socket) {
    if (this.refusingConnections) {
      socket.destroy()

      return
    }

    const client = new Client(this.nextClient++, socket)
    let buffer = ''

    this.clients.add(client)
    socket.on('close', () => this.clients.delete(client))
    socket.on('error', () => this.clients.delete(client))
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      if (buffer.length > maxElementBytes) {
        socket.destroy()

        return
      }

      while (true) {
        const element = /^\s*(<(\w+)[^>]*\/>|<(\w+)[^>]*>[\s\S]*?<\/\3>)/.exec(buffer)

        if (!element) break
        buffer = buffer.slice(element[0].length)
        this.handle(client, element[1]!)
      }
    })
  }

  private handle(client: Client, xml: string) {
    this.received.push(xml)
    if (this.options.receivedLimit !== undefined && this.received.length > this.options.receivedLimit) this.received.shift()
    const openingTag = xml.slice(0, xml.indexOf('>') + 1)
    const attributes = Object.fromEntries([...openingTag.matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], unescape(match[2]!)]))

    if (xml.startsWith('<getProperties')) {
      if (!this.answering) return
      for (const vector of this.vectors.values()) {
        if (attributes.device && attributes.device !== vector.device) continue
        if (attributes.name && attributes.name !== vector.name) continue
        if (this.muted.has(vector.device)) continue
        if (client.modeFor(vector.device, vector.name) === 'Only') continue
        client.write(this.definition(vector))
      }

      return
    }

    if (xml.startsWith('<pingRequest')) {
      client.write(`<pingReply uid="${attributes.uid}"/>\n`)

      return
    }

    if (xml.startsWith('<enableBLOB')) {
      const mode = />\s*(Never|Also|Only)\s*</.exec(xml)?.[1] as BlobMode | undefined

      if (mode && attributes.device) client.blobModes.set(`${attributes.device}.${attributes.name ?? ''}`, mode)

      return
    }

    const command = /^<new(Number|Switch|Text)Vector/.exec(xml)

    if (!command) return
    const vector = this.vectors.get(`${attributes.device}.${attributes.name}`)

    if (!vector) return
    const values = Object.fromEntries([...xml.matchAll(/<one\w+ name="([^"]+)">([^<]*)<\/one\w+>/g)].map(match => [unescape(match[1]!), unescape(match[2]!.trim())]))

    if (this.behaviour(this, vector, values, client) === 'handled') return
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

  /** The vector as a driver defines it, with its current values and state. */
  definition(vector: FakeVector): string {
    const tag = tags[vector.kind]
    const rule = vector.rule ? ` rule="${vector.rule}"` : ''
    const body = Object.entries(vector.elements)
      .map(([name, element]) => {
        const limits = vector.kind === 'number' ? ` format="${escape(element.format ?? '%g')}" min="${element.min ?? 0}" max="${element.max ?? 0}" step="${element.step ?? 0}"` : ''

        return vector.kind === 'blob'
          ? `  <defBLOB name="${escape(name)}" label="${escape(element.label ?? name)}"/>\n`
          : `  <def${tag} name="${escape(name)}" label="${escape(element.label ?? name)}"${limits}>${format(element.value)}</def${tag}>\n`
      })
      .join('')

    return `<def${tag}Vector device="${escape(vector.device)}" name="${escape(vector.name)}" label="${escape(vector.label ?? vector.name)}" group="${escape(vector.group ?? 'Main')}" state="${vector.state}" perm="${vector.perm}"${rule} timeout="${vector.timeout ?? 60}">\n${body}</def${tag}Vector>\n`
  }

  /** Everything but an image skips a client whose `enableBLOB` is `Only` for that device or property, as indiserver does. */
  private broadcast(xml: string, device?: string, property = '', isImage = false) {
    if (device !== undefined && this.muted.has(device)) return
    for (const client of this.clients) {
      if (!isImage && device !== undefined && client.modeFor(device, property) === 'Only') continue
      client.write(xml)
    }
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
