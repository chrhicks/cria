/**
 * Test support: a small INDI server written from the protocol, not from
 * Cria's code, for the cases simulators can't produce on demand: a driver that
 * never answers, refuses, ignores an abort, disappears, or loses the
 * connection. It keeps its own property state and answers requests from it.
 *
 * Deliberately independent of @cria/indi: it parses client XML with its own
 * code, so it can disagree with Cria's parser.
 *
 * Each client is a connection with its own subscriptions (`getProperties` and `enableBLOB` name what it hears
 * about, as in indiserver) and its own `enableBLOB` modes: `sendBlob`
 * broadcasts to every client as it always did, `deliverBlob` sends only to
 * clients whose mode allows it and writes in chunks, so a 50 MB image is never
 * one string or one write.
 */
import net from 'node:net'
import { BlobSettings, type BlobMode } from './blob-settings.js'
import { Interest } from './interest.js'

export type { BlobMode }

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

/** New limits for number elements, as a driver sends them in a `setNumberVector`: only what changed. */
export type Limits = Record<string, { min?: number; max?: number; step?: number }>

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
  /** How many times the driver defines this property in one answer to a device-wide `getProperties`. Default 1. */
  readonly repeats?: number
  /**
   * What the driver sets in its answer to a device-wide `getProperties`, as the telescope simulator does
   * TELESCOPE_MOUNT_TYPE: right after it defines the property `after` of this device. The set carries the
   * vector's values and state as they are when asked, with this `timeout` and `message`. An ask that names a property is not answered with it.
   */
  readonly answerSet?: { readonly after: string; readonly timeout?: number; readonly message?: string }
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

export interface FakeIndiOptions {
  /** How many received elements `received` keeps, oldest dropped first. Default: all. */
  readonly receivedLimit?: number
}

const tags = { number: 'Number', switch: 'Switch', text: 'Text', light: 'Light', blob: 'BLOB' } as const

const imageChunkBytes = 54 * 1024
/** A client that sends more than this without finishing one element is cut off: the fake reads small commands only. */
const maxElementBytes = 1024 * 1024

class Client implements FakeClient {
  readonly blobs = new BlobSettings()
  readonly interest = new Interest()
  private tail: Promise<void> = Promise.resolve()
  private queued = 0

  readonly id: number
  readonly socket: net.Socket

  constructor(id: number, socket: net.Socket) {
    this.id = id
    this.socket = socket
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

  /** A driver defines a property. `message` rides on this definition alone: a later answer to a `getProperties` does not repeat it. */
  define(vector: Omit<FakeVector, 'state'> & { state?: FakeVector['state'] }, options: { readonly message?: string } = {}): void {
    const full: FakeVector = { state: 'Idle', ...vector }

    this.vectors.set(`${full.device}.${full.name}`, full)
    this.broadcast(this.definition(full, options.message), full.device, full.name)
  }

  /**
   * A driver's standalone `<message>`: to every client that watches `device` as a whole, or, without a device, to every client.
   * The text is optional, as it is on the wire.
   */
  message(device: string | undefined, text?: string): void {
    this.broadcast(`<message${device === undefined ? '' : ` device="${escape(device)}"`}${messageAttribute(text)}/>\n`, device)
  }

  /**
   * Sends `xml` exactly as given, to the clients that hear of `property` of `device`, for the element a real driver
   * sends that the fake would never build itself (a number that is not a number). The fake's own copy of the vector is not touched.
   */
  raw(xml: string, device: string, property?: string): void {
    this.broadcast(xml, device, property)
  }

  vector(device: string, name: string): FakeVector {
    const found = this.vectors.get(`${device}.${name}`)

    if (!found) throw new Error(`Fake has no ${device}.${name}`)

    return found
  }

  /**
   * Changes state, values and number limits and tells every client who hears of the property, as a driver's
   * IDSet* does: all elements' values, and min/max/step on the elements whose limits `limits` changed. A driver
   * may send the vector's `timeout` and a `message` with it; neither is kept.
   */
  update(device: string, name: string, change: { state?: FakeVector['state']; values?: Record<string, Value>; limits?: Limits; message?: string; timeout?: number }): void {
    const vector = this.vector(device, name)

    if (change.state) vector.state = change.state
    for (const [element, value] of Object.entries(change.values ?? {})) vector.elements[element]!.value = value
    for (const [element, limits] of Object.entries(change.limits ?? {})) Object.assign(vector.elements[element]!, limits)

    this.broadcast(this.setVector(vector, change), device, name)
  }

  private setVector(vector: FakeVector, change: { limits?: Limits; message?: string; timeout?: number }): string {
    const tag = tags[vector.kind]
    const body = Object.entries(vector.elements)
      .map(([element, { value }]) => `  <one${tag} name="${escape(element)}"${limitAttributes(change.limits?.[element])}>${format(value)}</one${tag}>\n`)
      .join('')

    return `<set${tag}Vector device="${escape(vector.device)}" name="${escape(vector.name)}" state="${vector.state}"${change.timeout === undefined ? '' : ` timeout="${change.timeout}"`}${messageAttribute(change.message)}>\n${body}</set${tag}Vector>\n`
  }

  sendBlob(device: string, name: string, element: string, data: Buffer): void {
    this.broadcast(
      `<setBLOBVector device="${device}" name="${name}" state="Ok">\n  <oneBLOB name="${element}" size="${data.length}" format=".fits" len="${data.length}">\n${data.toString('base64').replace(/.{72}/g, '$&\n')}\n  </oneBLOB>\n</setBLOBVector>\n`,
      device,
      name,
      true,
    )
  }

  /**
   * Sends an image the way indiserver does: only to clients that hear of the property and whose `enableBLOB`
   * mode for it is `Also` or `Only`, as base64 written in chunks that
   * wait for the socket to drain. Resolves with how many clients were sent it,
   * once the last chunk is written. Aborting `signal` stops the delivery: an
   * image not yet started is not sent, and one half written closes its
   * connection, because an element cannot be finished or withdrawn.
   */
  async deliverBlob(device: string, name: string, element: string, data: Buffer, options: { readonly format?: string; readonly message?: string; readonly timeout?: number; readonly signal?: AbortSignal } = {}): Promise<number> {
    const { format = '.fits', message, timeout, signal } = options

    if (this.muted.has(device) || signal?.aborted) return 0

    const held = this.vectors.get(`${device}.${name}`)

    // The vector now says Ok, as the image's own `state` does: a client that asks for the definition afterwards is told so.
    if (held) held.state = 'Ok'
    const wanting = [...this.clients].filter(client => client.interest.covers(device, name) && client.blobs.wantsImage(device, name))
    const head = `<setBLOBVector device="${escape(device)}" name="${escape(name)}" state="Ok"${timeout === undefined ? '' : ` timeout="${timeout}"`}${messageAttribute(message)}>\n  <oneBLOB name="${escape(element)}" size="${data.length}" format="${escape(format)}" len="${data.length}">\n`
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
  removeDevice(device: string, options: { readonly message?: string } = {}): void {
    for (const key of [...this.vectors.keys()]) if (key.startsWith(`${device}.`)) this.vectors.delete(key)
    this.broadcast(`<delProperty device="${escape(device)}"${messageAttribute(options.message)}/>\n`, device)
  }

  /** One property went away. */
  removeVector(device: string, name: string, options: { readonly message?: string } = {}): void {
    this.vectors.delete(`${device}.${name}`)
    this.broadcast(`<delProperty device="${escape(device)}" name="${escape(name)}"${messageAttribute(options.message)}/>\n`, device, name)
  }

  onStop(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  dropConnections(): void {
    for (const client of this.clients) client.socket.destroy()
  }

  /** Whether `client` hears of this property and asked for its images (`enableBLOB` Also or Only). */
  wantsBlobs(client: FakeClient, device: string, name: string): boolean {
    return (client as Client).interest.covers(device, name) && (client as Client).blobs.wantsImage(device, name)
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
      client.interest.add(attributes.device || undefined, attributes.name || undefined)
      if (this.answering) this.answer(attributes.device || undefined, attributes.name || undefined)

      return
    }

    if (xml.startsWith('<pingRequest')) {
      client.write(`<pingReply uid="${attributes.uid}"/>\n`)

      return
    }

    if (xml.startsWith('<enableBLOB')) {
      const mode = />\s*(Never|Also|Only)\s*</.exec(xml)?.[1] as BlobMode | undefined

      if (mode && attributes.device) {
        client.blobs.set(attributes.device, attributes.name || undefined, mode)
        client.interest.add(attributes.device, attributes.name || undefined)
      }

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
  definition(vector: FakeVector, message?: string): string {
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

    // A light vector has no permission and no timeout: the property is the driver's to say, never a client's to set.
    const writable = vector.kind === 'light' ? '' : ` perm="${vector.perm}"${rule} timeout="${vector.timeout ?? 60}"`

    return `<def${tag}Vector device="${escape(vector.device)}" name="${escape(vector.name)}" label="${escape(vector.label ?? vector.name)}" group="${escape(vector.group ?? 'Main')}" state="${vector.state}"${writable}${messageAttribute(message)}>\n${body}</def${tag}Vector>\n`
  }

  /**
   * The driver's answer to a `getProperties`, delivered as indiserver delivers it: to every client that hears
   * of each definition, not only the one that asked. A device-wide request is answered with each property once,
   * then again with those the driver defines more than once (`repeats`); a request for one property, once.
   * A device-wide request also carries each property's `answerSet`, after the last definition of the property it follows.
   */
  private answer(device: string | undefined, name: string | undefined) {
    const asked = [...this.vectors.values()].filter(vector => (device === undefined || vector.device === device) && (name === undefined || vector.name === name))
    const passes = name === undefined ? Math.max(1, ...asked.map(vector => vector.repeats ?? 1)) : 1

    for (let pass = 1; pass <= passes; pass++)
      for (const vector of asked) {
        if ((vector.repeats ?? 1) < pass) continue
        this.broadcast(this.definition(vector), vector.device, vector.name)
        if (name !== undefined || pass < (vector.repeats ?? 1)) continue
        for (const other of asked) if (other.answerSet?.after === vector.name && other.device === vector.device) this.broadcast(this.setVector(other, other.answerSet), other.device, other.name)
      }
  }

  /**
   * Sends `xml` to the clients that hear of `property` of `device`, except one whose latest device-wide `enableBLOB` is
   * `Only`, as indiserver does. Without a device it goes to every client. An image (`sendBlob`) goes to every client.
   */
  private broadcast(xml: string, device?: string, property?: string, isImage = false) {
    if (device !== undefined && this.muted.has(device)) return
    for (const client of this.clients) {
      if (!isImage && ((device !== undefined && !client.interest.covers(device, property)) || client.blobs.withholdsOthers())) continue
      client.write(xml)
    }
  }
}

function messageAttribute(message: string | undefined): string {
  return message === undefined ? '' : ` message="${escape(message)}"`
}

function limitAttributes(limits: Limits[string] | undefined): string {
  if (!limits) return ''

  return (['min', 'max', 'step'] as const).map(key => (limits[key] === undefined ? '' : ` ${key}="${limits[key]}"`)).join('')
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
