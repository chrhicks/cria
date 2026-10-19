/**
 * INDI boundary: XML. Turns the indiserver byte stream into INDI messages and
 * INDI requests into bytes. Nothing outside this package sees XML.
 *
 * INDI's XML is a small, flat dialect: a stream of top-level elements with no
 * namespaces, CDATA or DTDs. The framer finds whole top-level elements in the
 * bytes; BLOB payloads (tens of megabytes of base64) are decoded straight from
 * the byte buffer, never assembled into intermediate strings chunk by chunk.
 */

export type PropertyState = 'Idle' | 'Ok' | 'Busy' | 'Alert'
export type PropertyKind = 'number' | 'switch' | 'text' | 'light' | 'blob'
export type Permission = 'ro' | 'wo' | 'rw'

export type ElementDefinition =
  | { readonly kind: 'number'; readonly name: string; readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number }
  | { readonly kind: 'switch'; readonly name: string; readonly label: string; readonly on: boolean }
  | { readonly kind: 'text'; readonly name: string; readonly label: string; readonly value: string }
  | { readonly kind: 'light'; readonly name: string; readonly label: string; readonly state: PropertyState }
  | { readonly kind: 'blob'; readonly name: string; readonly label: string }

export type ElementUpdate =
  | { readonly kind: 'number'; readonly name: string; readonly value: number; readonly min?: number; readonly max?: number; readonly step?: number }
  | { readonly kind: 'switch'; readonly name: string; readonly on: boolean }
  | { readonly kind: 'text'; readonly name: string; readonly value: string }
  | { readonly kind: 'light'; readonly name: string; readonly state: PropertyState }
  | { readonly kind: 'blob'; readonly name: string; readonly format: string; readonly size: number; readonly data: Buffer }

export interface VectorDefinition {
  readonly device: string
  readonly name: string
  readonly kind: PropertyKind
  readonly label: string
  readonly state: PropertyState
  readonly perm: Permission
  readonly message?: string
  readonly elements: ReadonlyArray<ElementDefinition>
}

export interface VectorUpdate {
  readonly device: string
  readonly name: string
  readonly kind: PropertyKind
  readonly state?: PropertyState
  readonly message?: string
  readonly elements: ReadonlyArray<ElementUpdate>
}

export type IndiMessage =
  | { readonly type: 'def'; readonly vector: VectorDefinition }
  | { readonly type: 'set'; readonly vector: VectorUpdate }
  | { readonly type: 'del'; readonly device: string; readonly name?: string }
  | { readonly type: 'pingRequest'; readonly uid: string }

export class IndiProtocolError extends Error {
  override readonly name = 'IndiProtocolError'
}

// ---------------------------------------------------------------- framing

const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f

/** Maximum bytes for one element; protects memory from a runaway stream. */
const maxElementBytes = 512 * 1024 * 1024

/**
 * Accumulates bytes and yields complete top-level elements. Grows its buffer
 * geometrically so a 70 MB BLOB arriving in 64 KB chunks costs linear time.
 */
export class IndiFramer {
  private buffer = Buffer.allocUnsafe(1 << 16)
  private length = 0
  private start = 0
  private searchFrom = 0
  private closing: Buffer | undefined

  push(chunk: Buffer): IndiMessage[] {
    const messages: IndiMessage[] = []

    this.collect(chunk, (_, message) => {
      if (message) messages.push(message)
    })

    return messages
  }

  /**
   * Like `push`, and keeps every element, the ignored ones too, with its wire
   * text and BLOB payloads. For the traffic tap; `push` costs none of this.
   */
  pushFramed(chunk: Buffer): FramedElement[] {
    const framed: FramedElement[] = []

    this.collect(chunk, (element, message) => framed.push({ message, xml: elideBlobs(element), blobs: blobsOf(message) }))

    return framed
  }

  private collect(chunk: Buffer, onElement: (element: Buffer, message: IndiMessage | undefined) => void) {
    this.append(chunk)

    while (true) {
      const element = this.nextElement()

      if (!element) break
      onElement(element, parseElement(element))
    }

    this.compact()
  }

  private append(chunk: Buffer) {
    if (this.length + chunk.length > this.buffer.length) {
      let size = this.buffer.length

      while (size < this.length + chunk.length) size *= 2
      const grown = Buffer.allocUnsafe(size)

      this.buffer.copy(grown, 0, 0, this.length)
      this.buffer = grown
    }

    chunk.copy(this.buffer, this.length)
    this.length += chunk.length
  }

  private nextElement(): Buffer | undefined {
    if (!this.closing) {
      const open = this.buffer.indexOf(LT, this.start)

      if (open < 0 || open >= this.length) {
        this.start = this.length

        return undefined
      }

      this.start = open
      const headerEnd = this.buffer.indexOf(GT, open)

      if (headerEnd < 0 || headerEnd >= this.length) return undefined
      const header = this.buffer.toString('utf8', open + 1, headerEnd)

      if (header.startsWith('?') || header.startsWith('!')) {
        const after = this.skipDeclaration(open)

        if (after < 0) return undefined
        this.start = after

        return this.nextElement()
      }

      if (this.buffer[headerEnd - 1] === SLASH) {
        this.start = headerEnd + 1

        return this.buffer.subarray(open, headerEnd + 1)
      }

      const tag = /^([A-Za-z][\w]*)/.exec(header)?.[1]

      if (!tag) throw new IndiProtocolError(`Malformed INDI element <${header.slice(0, 40)}>`)
      this.closing = Buffer.from(`</${tag}>`)
      this.searchFrom = headerEnd + 1
    }

    const close = this.buffer.indexOf(this.closing, this.searchFrom)

    if (close < 0 || close + this.closing.length > this.length) {
      this.searchFrom = Math.max(this.start, this.length - this.closing.length)
      if (this.length - this.start > maxElementBytes)
        throw new IndiProtocolError('INDI element exceeds the size limit')

      return undefined
    }

    const end = close + this.closing.length
    const element = this.buffer.subarray(this.start, end)

    this.start = end
    this.closing = undefined

    return element
  }

  /** Comments and processing instructions carry nothing for a client. */
  private skipDeclaration(open: number): number {
    const isComment = this.buffer.toString('utf8', open, open + 4) === '<!--'
    const terminator = isComment ? '-->' : '>'
    const end = this.buffer.indexOf(terminator, open)

    if (end < 0 || end >= this.length) return -1

    return end + terminator.length
  }

  private compact() {
    if (this.start === 0) return

    // Elements already returned are copies (parseElement), so the bytes can move.
    this.buffer.copy(this.buffer, 0, this.start, this.length)
    this.length -= this.start
    this.searchFrom = Math.max(0, this.searchFrom - this.start)
    this.start = 0

    // After a 70 MB BLOB the buffer would stay that big; give it back when idle.
    if (this.buffer.length > 4 * 1024 * 1024 && this.length < 64 * 1024) {
      const smaller = Buffer.allocUnsafe(1 << 16)

      this.buffer.copy(smaller, 0, 0, this.length)
      this.buffer = smaller
    }
  }
}

export interface FramedElement {
  /** Undefined for an element the client ignores (`<message>`, unknown tags). */
  readonly message: IndiMessage | undefined
  /** The element's wire text with each BLOB payload removed: `<oneBLOB name="CCD1" size="9" format=".fits"/>`. */
  readonly xml: string
  /** The decoded payload of each elided `oneBLOB`, in document order. */
  readonly blobs: ReadonlyArray<Buffer>
}

function blobsOf(message: IndiMessage | undefined): Buffer[] {
  if (message?.type !== 'set' || message.vector.kind !== 'blob') return []

  return message.vector.elements.flatMap(element => (element.kind === 'blob' ? [element.data] : []))
}

/** Pure: `element` as text, each `oneBLOB` payload dropped. Walks the bytes the way `parseBlobVector` does. */
function elideBlobs(element: Buffer): string {
  if (!element.toString('latin1', 0, 14).startsWith('<setBLOBVector')) return element.toString('utf8')

  const parts: string[] = []
  let kept = 0
  let from = 0

  while (true) {
    const open = element.indexOf('<oneBLOB', from)

    if (open < 0) break
    const openEnd = element.indexOf(GT, open)

    from = openEnd + 1
    if (element[openEnd - 1] === SLASH) continue
    const close = element.indexOf('</oneBLOB>', openEnd)

    if (close < 0) break
    parts.push(element.toString('utf8', kept, openEnd), '/>')
    kept = close + 10
    from = kept
  }

  parts.push(element.toString('utf8', kept))

  return parts.join('')
}

// ---------------------------------------------------------------- parsing

interface Node {
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: Node[]
  text: string
}

function parseElement(bytes: Buffer): IndiMessage | undefined {
  const tag = /^<([A-Za-z]\w*)/.exec(bytes.toString('latin1', 0, 64))?.[1] ?? ''

  if (tag === 'setBLOBVector') return parseBlobVector(bytes)

  const node = parseTree(bytes.toString('utf8'))

  return toMessage(node)
}

/** A tiny XML tree parser for INDI's dialect. */
function parseTree(xml: string): Node {
  let index = 0
  const stack: Node[] = []
  let root: Node | undefined

  while (index < xml.length) {
    const open = xml.indexOf('<', index)

    if (open < 0) break
    if (stack.length > 0) stack[stack.length - 1]!.text += decodeEntities(xml.slice(index, open))

    if (xml.startsWith('<!--', open)) {
      index = xml.indexOf('-->', open) + 3
      continue
    }

    const close = xml.indexOf('>', open)

    if (close < 0) throw new IndiProtocolError('Unterminated INDI tag')
    const inner = xml.slice(open + 1, close)

    if (inner.startsWith('/')) {
      const done = stack.pop()

      if (!done) throw new IndiProtocolError('Unbalanced INDI closing tag')
      if (stack.length === 0) root = done
    } else {
      const selfClosing = inner.endsWith('/')
      const body = selfClosing ? inner.slice(0, -1) : inner
      const name = /^([A-Za-z]\w*)/.exec(body)?.[1]

      if (!name) throw new IndiProtocolError(`Malformed INDI tag <${body.slice(0, 40)}>`)
      const node: Node = { tag: name, attributes: parseAttributes(body.slice(name.length)), children: [], text: '' }

      stack[stack.length - 1]?.children.push(node)
      if (selfClosing) {
        if (stack.length === 0) root = node
      } else {
        stack.push(node)
      }
    }

    index = close + 1
  }

  if (!root || stack.length > 0) throw new IndiProtocolError('Incomplete INDI element')

  return root
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g

  for (const match of text.matchAll(pattern)) {
    attributes[match[1]!] = decodeEntities(match[3] ?? match[4] ?? '')
  }

  return attributes
}

const namedEntities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text

  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))

    return namedEntities[entity] ?? whole
  })
}

const vectorKinds: Record<string, PropertyKind> = {
  Number: 'number',
  Switch: 'switch',
  Text: 'text',
  Light: 'light',
  BLOB: 'blob',
}

function toMessage(node: Node): IndiMessage | undefined {
  const a = node.attributes
  const vector = /^(def|set)(Number|Switch|Text|Light|BLOB)Vector$/.exec(node.tag)

  if (vector) {
    const kind = vectorKinds[vector[2]!]!

    return vector[1] === 'def' ? { type: 'def', vector: toDefinition(node, kind) } : { type: 'set', vector: toUpdate(node, kind) }
  }

  switch (node.tag) {
    case 'delProperty':
      return a.name === undefined ? { type: 'del', device: required(a, 'device') } : { type: 'del', device: required(a, 'device'), name: a.name }
    case 'pingRequest':
      return { type: 'pingRequest', uid: a.uid ?? '' }
    default:
      return undefined
  }
}

function toDefinition(node: Node, kind: PropertyKind): VectorDefinition {
  const a = node.attributes
  const elements = node.children.map(child => toElementDefinition(child, kind))

  return {
    device: required(a, 'device'),
    name: required(a, 'name'),
    kind,
    label: a.label ?? a.name ?? '',
    state: parseState(a.state ?? 'Idle'),
    perm: kind === 'light' ? 'ro' : parsePermission(a.perm ?? 'ro'),
    ...(a.message === undefined ? {} : { message: a.message }),
    elements,
  }
}

function toElementDefinition(node: Node, kind: PropertyKind): ElementDefinition {
  const a = node.attributes
  const name = required(a, 'name')
  const label = a.label ?? name
  const text = node.text.trim()

  switch (kind) {
    case 'number':
      return {
        kind,
        name,
        label,
        value: parseNumber(text),
        min: parseNumber(a.min ?? '0'),
        max: parseNumber(a.max ?? '0'),
        step: parseNumber(a.step ?? '0'),
      }
    case 'switch':
      return { kind, name, label, on: text === 'On' }
    case 'text':
      // indiserver pretty-prints values ("\nRGGB\n    "); the value is the trimmed text.
      return { kind, name, label, value: text }
    case 'light':
      return { kind, name, label, state: parseState(text) }
    case 'blob':
      return { kind, name, label }
  }
}

function toUpdate(node: Node, kind: PropertyKind): VectorUpdate {
  const a = node.attributes
  const elements: ElementUpdate[] = node.children.map(child => {
    const name = required(child.attributes, 'name')
    const text = child.text.trim()

    switch (kind) {
      case 'number': {
        const limits = child.attributes
        const update = { kind, name, value: parseNumber(text) }

        return {
          ...update,
          ...(limits.min === undefined ? {} : { min: parseNumber(limits.min) }),
          ...(limits.max === undefined ? {} : { max: parseNumber(limits.max) }),
          ...(limits.step === undefined ? {} : { step: parseNumber(limits.step) }),
        }
      }
      case 'switch':
        return { kind, name, on: text === 'On' }
      case 'text':
        return { kind, name, value: text }
      case 'light':
        return { kind, name, state: parseState(text) }
      case 'blob':
        throw new IndiProtocolError('BLOB vectors are parsed separately')
    }
  })

  return {
    device: required(a, 'device'),
    name: required(a, 'name'),
    kind,
    ...(a.state === undefined ? {} : { state: parseState(a.state) }),
    ...(a.message === undefined ? {} : { message: a.message }),
    elements,
  }
}

/** Parses setBLOBVector from bytes, decoding each payload without a full-element string. */
function parseBlobVector(bytes: Buffer): IndiMessage | undefined {
  const headerEnd = bytes.indexOf(GT)
  const header = parseAttributes(bytes.toString('utf8', 0, headerEnd))

  const elements: ElementUpdate[] = []
  let at = headerEnd

  while (true) {
    const open = bytes.indexOf('<oneBLOB', at)

    if (open < 0) break
    const openEnd = bytes.indexOf(GT, open)
    const attributes = parseAttributes(bytes.toString('utf8', open + 8, openEnd))

    if (bytes[openEnd - 1] === SLASH) {
      elements.push({ kind: 'blob', name: required(attributes, 'name'), format: attributes.format ?? '', size: 0, data: Buffer.alloc(0) })
      at = openEnd + 1
      continue
    }

    const close = bytes.indexOf('</oneBLOB>', openEnd)

    if (close < 0) throw new IndiProtocolError('Unterminated oneBLOB')
    // Node's base64 decoder skips the line breaks INDI inserts.
    const data = Buffer.from(bytes.toString('latin1', openEnd + 1, close), 'base64')
    const size = Number(attributes.size ?? data.length)

    elements.push({ kind: 'blob', name: required(attributes, 'name'), format: attributes.format ?? '', size, data })
    at = close + 10
  }

  return {
    type: 'set',
    vector: {
      device: required(header, 'device'),
      name: required(header, 'name'),
      kind: 'blob',
      ...(header.state === undefined ? {} : { state: parseState(header.state) }),
      ...(header.message === undefined ? {} : { message: header.message }),
      elements,
    },
  }
}

function required(attributes: Readonly<Record<string, string>>, name: string): string {
  const value = attributes[name]

  if (value === undefined) throw new IndiProtocolError(`INDI element is missing ${name}`)

  return value
}

function parseState(text: string): PropertyState {
  const state = text.trim()

  if (state === 'Idle' || state === 'Ok' || state === 'Busy' || state === 'Alert') return state
  throw new IndiProtocolError(`Unknown INDI state ${state}`)
}

function parsePermission(text: string): Permission {
  if (text === 'ro' || text === 'wo' || text === 'rw') return text
  throw new IndiProtocolError(`Unknown INDI permission ${text}`)
}

/** INDI numbers are decimal or sexagesimal ("-12:30:15.5", "12 30 15"). */
export function parseNumber(text: string): number {
  const trimmed = text.trim()

  if (/^[-+]?\d+([:\s]\d+(\.\d*)?){1,2}$/.test(trimmed)) {
    const negative = trimmed.startsWith('-')
    const parts = trimmed.replace(/^[-+]/, '').split(/[:\s]+/).map(Number)
    const value = parts.reduce((total, part, index) => total + part / 60 ** index, 0)

    return negative ? -value : value
  }

  const value = Number(trimmed)

  if (trimmed === '' || !Number.isFinite(value)) throw new IndiProtocolError(`Invalid INDI number "${text}"`)

  return value
}

// ---------------------------------------------------------------- requests

export type BlobMode = 'Never' | 'Also' | 'Only'

export type IndiRequest =
  | { readonly type: 'getProperties'; readonly device?: string; readonly name?: string }
  | { readonly type: 'enableBLOB'; readonly device: string; readonly name?: string; readonly mode: BlobMode }
  | { readonly type: 'new'; readonly kind: 'number' | 'switch' | 'text'; readonly device: string; readonly name: string; readonly values: Readonly<Record<string, number | boolean | string>> }
  | { readonly type: 'pingReply'; readonly uid: string }

export function serialize(request: IndiRequest): string {
  switch (request.type) {
    case 'getProperties':
      return `<getProperties version="1.7"${attribute('device', request.device)}${attribute('name', request.name)}/>\n`
    case 'enableBLOB':
      return `<enableBLOB${attribute('device', request.device)}${attribute('name', request.name)}>${request.mode}</enableBLOB>\n`
    case 'pingReply':
      return `<pingReply${attribute('uid', request.uid)}/>\n`
    case 'new': {
      const tag = { number: 'Number', switch: 'Switch', text: 'Text' }[request.kind]
      const elements = Object.entries(request.values)
        .map(([name, value]) => `  <one${tag}${attribute('name', name)}>${escape(formatValue(value))}</one${tag}>\n`)
        .join('')

      return `<new${tag}Vector${attribute('device', request.device)}${attribute('name', request.name)}>\n${elements}</new${tag}Vector>\n`
    }
  }
}

function formatValue(value: number | boolean | string): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new IndiProtocolError('Refusing to send a non-finite number')

    return String(value)
  }

  return value
}

function attribute(name: string, value: string | undefined): string {
  return value === undefined ? '' : ` ${name}="${escape(value)}"`
}

function escape(text: string): string {
  return text.replace(/[<>&"']/g, character => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[character]};`)
}
