/**
 * INDI boundary: XML. Turns the indiserver byte stream into INDI messages and
 * INDI requests into bytes. Nothing outside this package sees XML.
 *
 * INDI's XML is a small, flat dialect: a stream of top-level elements with no
 * namespaces, CDATA or DTDs. The framer finds whole top-level elements in the
 * bytes. A `setBLOBVector` is framed and skipped: Cria never asks for BLOBs.
 */
import { isUtf8 } from 'node:buffer'

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
  readonly kind: Exclude<PropertyKind, 'blob'>
  readonly state?: PropertyState
  readonly message?: string
  readonly elements: ReadonlyArray<ElementUpdate>
}

export type IndiMessage =
  | { readonly type: 'def'; readonly vector: VectorDefinition }
  | { readonly type: 'set'; readonly vector: VectorUpdate }
  | { readonly type: 'del'; readonly device: string; readonly name?: string }
  | { readonly type: 'pingRequest'; readonly uid: string }
  | { readonly type: 'message'; readonly device?: string; readonly text: string }

export type ElementValue = number | boolean | string

export interface WireFacts {
  readonly type: 'def' | 'set' | 'new' | 'del' | 'message' | 'other' | 'unreadable'
  readonly tag?: string
  readonly indiDevice?: string
  readonly property?: string
  readonly state?: PropertyState
  readonly elements?: Readonly<Record<string, ElementValue>>
  readonly text?: string
}

export class IndiProtocolError extends Error {
  override readonly name = 'IndiProtocolError'

  readonly scope: 'element' | 'framing'

  constructor(message: string, scope: 'element' | 'framing' = 'element') {
    super(message)
    this.scope = scope
  }
}

/** What the client needs to find a bad element again: where it was, why it failed, and a short look at its bytes. */
export interface ProtocolProblem {
  readonly scope: IndiProtocolError['scope']
  readonly reason: string
  /** The element's tag, or '' when not even that could be read. */
  readonly tag: string
  readonly device?: string
  readonly name?: string
  readonly utf8: boolean
  /** At most `excerptChars` of the element, control characters escaped. */
  readonly excerpt: string
  readonly bytes: number
}

// ---------------------------------------------------------------- framing

const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f
const DOUBLE_QUOTE = 0x22
const SINGLE_QUOTE = 0x27
const QUESTION_MARK = 0x3f
const BANG = 0x21

const excerptChars = 200
const inspectedBytes = 4096
const headBytes = inspectedBytes + 1
const topLevelStart = /^<(?:(?:def|set|new)(?:Number|Switch|Text|Light|BLOB)Vector|delProperty|message|pingRequest)[\s/>]/
const startLookahead = '<setNumberVector '.length

function startsTopLevel(buffer: Buffer, at: number, length: number): boolean | undefined {
  const text = buffer.toString('latin1', at, Math.min(length, at + startLookahead))

  if (topLevelStart.test(text)) return true

  return length - at < startLookahead ? undefined : false
}

interface Pending {
  readonly error: IndiProtocolError
  size: number
  head: Buffer
}

type Mode = 'between' | 'header' | 'declaration' | 'body' | 'discarding'

interface Step {
  readonly bytes: Buffer
  readonly size: number
  readonly error?: IndiProtocolError
}

type Outcome = Step | undefined | 'continue'

export class IndiFramer {
  private buffer = Buffer.allocUnsafe(1 << 16)
  private length = 0
  private start = 0
  private mode: Mode = 'between'
  private scanFrom = 0
  private quote = 0
  private closing: Buffer = Buffer.alloc(0)
  private pending: Pending | undefined

  frame(chunk: Buffer, keepText: boolean): { readonly elements: FramedElement[] } {
    const elements: FramedElement[] = []

    this.append(chunk)
    for (let step = this.next(); step; step = this.next()) elements.push(frameStep(step, keepText))
    this.compact()

    return { elements }
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

  private next(): Step | undefined {
    for (;;) {
      const outcome = this.advance()

      if (outcome !== 'continue') return outcome
    }
  }

  private advance(): Outcome {
    switch (this.mode) {
      case 'between':
        return this.between()
      case 'header':
        return this.header()
      case 'declaration':
        return this.declaration()
      case 'body':
        return this.body()
      case 'discarding':
        return this.discarding()
    }
  }

  private between(): Outcome {
    const open = this.buffer.indexOf(LT, this.start)
    const end = open < 0 || open >= this.length ? this.length : open

    if (end > this.start) {
      let from = this.start

      if (!this.pending) while (from < end && this.buffer[from]! <= 0x20) from++
      if (from < end) this.absorb(from, end, 'Text outside any INDI element')
      this.start = end
    }

    if (end === this.length) return undefined
    if (this.pending) return this.flush()

    this.mode = 'header'
    this.scanFrom = open + 1
    this.quote = 0

    return 'continue'
  }

  private header(): Outcome {
    const open = this.start

    if (open + 1 >= this.length) return undefined

    const second = this.buffer[open + 1]

    if (second === QUESTION_MARK || second === BANG) {
      if (second === BANG && this.length - open < 4 && '<!--'.startsWith(this.buffer.toString('latin1', open, this.length))) return undefined
      this.mode = 'declaration'
      this.scanFrom = open
      this.closing = Buffer.from(this.buffer.toString('latin1', open, open + 4) === '<!--' ? '-->' : '>')

      return 'continue'
    }

    for (let at = this.scanFrom; at < this.length; at++) {
      const byte = this.buffer[at]!

      if (byte === LT) {
        const decided = startsTopLevel(this.buffer, at, this.length)

        if (this.quote === 0 || decided === true) return this.abandon('Tag is not closed before the next element starts', at)
        if (decided === undefined) {
          this.scanFrom = at

          return undefined
        }
      } else if (this.quote !== 0) {
        if (byte === this.quote) this.quote = 0
      } else if (byte === DOUBLE_QUOTE || byte === SINGLE_QUOTE) {
        this.quote = byte
      } else if (byte === GT) {
        return this.opened(open, at)
      }
    }

    this.scanFrom = this.length

    return undefined
  }

  private opened(open: number, headerEnd: number): Outcome {
    const tag = /^([A-Za-z]\w*)/.exec(this.buffer.toString('latin1', open + 1, Math.min(headerEnd, open + 1 + 64)))?.[1]

    if (!tag) return this.abandon(`Malformed INDI element <${this.buffer.toString('utf8', open + 1, Math.min(headerEnd, open + 41))}>`, open + 1)

    if (this.buffer[headerEnd - 1] === SLASH) {
      this.start = headerEnd + 1
      this.mode = 'between'

      return { bytes: this.buffer.subarray(open, headerEnd + 1), size: headerEnd + 1 - open }
    }

    this.closing = Buffer.from(`</${tag}>`)
    this.scanFrom = headerEnd + 1
    this.mode = 'body'

    return 'continue'
  }

  private body(): Outcome {
    for (let at = this.buffer.indexOf(LT, this.scanFrom); at >= 0 && at < this.length; at = this.buffer.indexOf(LT, at + 1)) {
      const available = Math.min(this.closing.length, this.length - at)

      if (this.buffer.subarray(at, at + available).equals(this.closing.subarray(0, available))) {
        if (available < this.closing.length) {
          this.scanFrom = at

          return undefined
        }

        const bytes = this.buffer.subarray(this.start, at + available)

        this.start = at + available
        this.mode = 'between'

        return { bytes, size: bytes.length }
      }

      const decided = startsTopLevel(this.buffer, at, this.length)

      if (decided === undefined) {
        this.scanFrom = at

        return undefined
      }

      if (decided) {
        const bytes = this.buffer.subarray(this.start, at)

        this.start = at
        this.mode = 'between'

        return { bytes, size: bytes.length, error: new IndiProtocolError('Incomplete INDI element: it is never closed before the next element starts', 'framing') }
      }
    }

    this.scanFrom = this.length

    return undefined
  }

  private declaration(): Outcome {
    const end = this.buffer.indexOf(this.closing, this.scanFrom)

    if (end < 0 || end + this.closing.length > this.length) {
      this.scanFrom = Math.max(this.start, this.length - this.closing.length + 1)

      return undefined
    }

    this.start = end + this.closing.length
    this.mode = 'between'

    return 'continue'
  }

  private discarding(): Outcome {
    for (let at = this.buffer.indexOf(LT, this.scanFrom); at >= 0 && at < this.length; at = this.buffer.indexOf(LT, at + 1)) {
      const decided = startsTopLevel(this.buffer, at, this.length)

      if (decided === undefined) {
        this.absorb(this.start, at)
        this.start = at
        this.scanFrom = at

        return undefined
      }

      if (decided) {
        this.absorb(this.start, at)
        this.start = at

        return this.flush()
      }
    }

    this.absorb(this.start, this.length)
    this.start = this.length
    this.scanFrom = this.length

    return undefined
  }

  private abandon(reason: string, from: number): 'continue' {
    this.pending = { error: new IndiProtocolError(reason, 'framing'), size: 0, head: Buffer.alloc(0) }
    this.mode = 'discarding'
    this.scanFrom = from

    return 'continue'
  }

  private absorb(from: number, to: number, reason?: string) {
    this.pending ??= { error: new IndiProtocolError(reason ?? 'Skipped bytes', 'framing'), size: 0, head: Buffer.alloc(0) }

    const pending = this.pending

    pending.size += to - from
    if (pending.head.length < headBytes) pending.head = Buffer.concat([pending.head, this.buffer.subarray(from, Math.min(to, from + headBytes - pending.head.length))])
  }

  private flush(): Step {
    const { error, size, head } = this.pending!

    this.pending = undefined
    this.mode = 'between'

    return { bytes: head, size, error }
  }

  private compact() {
    if (this.start === 0) return

    this.buffer.copy(this.buffer, 0, this.start, this.length)
    this.length -= this.start
    this.scanFrom = Math.max(0, this.scanFrom - this.start)
    this.start = 0

    if (this.buffer.length > 4 * 1024 * 1024 && this.length < 64 * 1024) {
      const smaller = Buffer.allocUnsafe(1 << 16)

      this.buffer.copy(smaller, 0, 0, this.length)
      this.buffer = smaller
    }
  }
}

export interface FramedElement {
  readonly message: IndiMessage | undefined
  readonly problem?: ProtocolProblem
  readonly facts: WireFacts
  readonly xml: string
}

function frameStep(step: Step, keepText: boolean): FramedElement {
  if (step.error) {
    const problem = describeProblem(step.error, step.bytes, step.size)

    return { message: undefined, facts: unreadableFacts(problem), problem, xml: keepText ? step.bytes.toString('utf8') : '' }
  }

  return frameElement(step.bytes, keepText)
}

function frameElement(element: Buffer, keepText: boolean): FramedElement {
  let message: IndiMessage | undefined
  let facts: WireFacts | undefined
  let problem: ProtocolProblem | undefined

  try {
    const parsed = parseElement(element)

    message = parsed.message
    facts = parsed.facts
    if (parsed.dropped[0]) problem = describeProblem(parsed.dropped[0], element, element.length)
  } catch (error) {
    if (!(error instanceof IndiProtocolError)) throw error
    problem = describeProblem(error, element, element.length)
  }

  return {
    message,
    facts: facts ?? unreadableFacts(problem),
    ...(problem ? { problem } : {}),
    xml: keepText ? element.toString('utf8') : '',
  }
}

function unreadableFacts(problem: ProtocolProblem | undefined): WireFacts {
  return {
    type: 'unreadable',
    tag: problem?.tag ?? '',
    ...(problem?.device === undefined ? {} : { indiDevice: problem.device }),
    ...(problem?.name === undefined ? {} : { property: problem.name }),
    text: problem?.reason ?? '',
  }
}

function describeProblem(error: IndiProtocolError, element: Buffer, size: number): ProtocolProblem {
  const bytes = leading(element)
  const decoded = bytes.toString('utf8')
  const headerEnd = tagEnd(decoded, 0)
  const header = headerEnd < 0 ? decoded : decoded.slice(0, headerEnd)
  const tag = /^\s*<([A-Za-z]\w*)/.exec(header)?.[1] ?? ''
  const attributes = parseAttributes(/^\s*<[A-Za-z]\w*([\s\S]*)/.exec(header)?.[1] ?? '')
  const text = bytes.toString('utf8', 0, excerptChars * 4)
  const escaped = JSON.stringify(text.slice(0, excerptChars)).slice(1, -1)

  return {
    scope: error.scope,
    reason: error.message.length > excerptChars ? `${error.message.slice(0, excerptChars)}...` : error.message,
    tag,
    ...(attributes.device ? { device: attributes.device } : {}),
    ...(attributes.name ? { name: attributes.name } : {}),
    utf8: isUtf8(bytes),
    excerpt: text.length > excerptChars ? `${escaped}...` : escaped,
    bytes: size,
  }
}

function leading(element: Buffer): Buffer {
  if (element.length <= inspectedBytes) return element
  let end = inspectedBytes

  while (end > inspectedBytes - 4 && (element[end]! & 0xc0) === 0x80) end--

  return element.subarray(0, end)
}

function tagEnd(text: string, from: number): number {
  let quote = ''

  for (let at = from; at < text.length; at++) {
    const character = text[at]!

    if (quote !== '') {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return at
    }
  }

  return -1
}

// ---------------------------------------------------------------- parsing

interface Node {
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: Node[]
  text: string
}

function parseElement(bytes: Buffer): { readonly message: IndiMessage | undefined; readonly facts: WireFacts; readonly dropped: IndiProtocolError[] } {
  const tag = /^<([A-Za-z]\w*)/.exec(bytes.toString('latin1', 0, 64))?.[1] ?? ''
  const dropped: IndiProtocolError[] = []

  if (tag === 'setBLOBVector') return { message: undefined, facts: blobFacts(bytes), dropped }

  const node = parseTree(bytes.toString('utf8'))
  const message = toMessage(node, dropped)

  return { message, facts: message ? factsOfMessage(message) : factsOfNewVector(node, dropped), dropped }
}

function blobFacts(bytes: Buffer): WireFacts {
  const header = leading(bytes).toString('utf8')
  const attributes = parseAttributes(/^\s*<[A-Za-z]\w*([^>]*)/.exec(header)?.[1] ?? '')
  const state = attributes.state

  return {
    type: 'set',
    ...(attributes.device ? { indiDevice: attributes.device } : {}),
    ...(attributes.name ? { property: attributes.name } : {}),
    ...(state === 'Idle' || state === 'Ok' || state === 'Busy' || state === 'Alert' ? { state } : {}),
  }
}

function valuesOf(elements: ReadonlyArray<ElementDefinition | ElementUpdate>): Record<string, ElementValue> {
  const values: Record<string, ElementValue> = {}

  for (const element of elements) {
    switch (element.kind) {
      case 'number':
      case 'text':
        values[element.name] = element.value
        break
      case 'switch':
        values[element.name] = element.on
        break
      case 'light':
        values[element.name] = element.state
        break
      case 'blob':
        break
    }
  }

  return values
}

function factsOfMessage(message: IndiMessage): WireFacts {
  switch (message.type) {
    case 'def':
    case 'set': {
      const { vector } = message

      return {
        type: message.type,
        indiDevice: vector.device,
        property: vector.name,
        ...(vector.state === undefined ? {} : { state: vector.state }),
        elements: valuesOf(vector.elements),
        ...(vector.message === undefined ? {} : { text: vector.message }),
      }
    }
    case 'del':
      return { type: 'del', indiDevice: message.device, ...(message.name === undefined ? {} : { property: message.name }) }
    case 'message':
      return { type: 'message', ...(message.device === undefined ? {} : { indiDevice: message.device }), text: message.text }
    case 'pingRequest':
      return { type: 'other', tag: 'pingRequest' }
  }
}

function factsOfNewVector(node: Node, dropped: IndiProtocolError[]): WireFacts {
  const kind = node.tag.slice('new'.length, -'Vector'.length)
  const values: Record<string, ElementValue> = {}

  for (const child of namedChildren(node, dropped)) {
    const text = child.text.trim()

    const name = child.attributes.name!
    const number = Number(text)

    if (kind === 'Number') values[name] = text !== '' && Number.isFinite(number) ? number : text
    else if (kind === 'Switch') values[name] = text === 'On' ? true : text === 'Off' ? false : text
    else if (kind === 'Text') values[name] = text
  }

  return { type: 'new', indiDevice: identity(node.attributes, 'device'), property: identity(node.attributes, 'name'), elements: values }
}

export function factsOfRequest(request: IndiRequest): WireFacts {
  switch (request.type) {
    case 'getProperties':
      return {
        type: 'other',
        tag: 'getProperties',
        ...(request.device === undefined ? {} : { indiDevice: request.device }),
        ...(request.name === undefined ? {} : { property: request.name }),
      }
    case 'pingReply':
      return { type: 'other', tag: 'pingReply' }
    case 'new':
      return { type: 'new', indiDevice: request.device, property: request.name, elements: request.values }
  }
}

function namedChildren(node: Node, dropped: IndiProtocolError[]): Node[] {
  return node.children.filter(child => {
    const fault = identityFault(child.attributes, 'name')

    if (fault) dropped.push(new IndiProtocolError(fault))

    return fault === undefined
  })
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
      const end = xml.indexOf('-->', open)

      if (end < 0) throw new IndiProtocolError('Unterminated comment in INDI element')
      index = end + 3
      continue
    }

    const close = tagEnd(xml, open + 1)

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

  if (!root || stack.length > 0) throw new IndiProtocolError('Incomplete INDI element: a tag is never closed')

  return root
}

export function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  // Once a kind of quote has no closing mate in the rest of the text, none after it has one either.
  const unclosed = new Set<string>()
  let at = 0

  // `name = "value"` or `name = 'value'`, read left to right in one pass: a name with no value is skipped as a
  // whole word, so a long run of junk costs its length and no more (a regex retried from every letter did not).
  while (at < text.length) {
    if (!/[A-Za-z_]/.test(text[at]!)) {
      at++
      continue
    }
    let end = at + 1

    while (end < text.length && /[\w.-]/.test(text[end]!)) end++
    const name = text.slice(at, end)

    while (end < text.length && /\s/.test(text[end]!)) end++
    if (text[end] !== '=') {
      at = end
      continue
    }
    end++
    while (end < text.length && /\s/.test(text[end]!)) end++
    const quote = text[end]

    if (quote !== '"' && quote !== "'") {
      at = end
      continue
    }
    const close = unclosed.has(quote) ? -1 : text.indexOf(quote, end + 1)

    if (close < 0) {
      unclosed.add(quote)
      at = end
      continue
    }
    attributes[name] = decodeEntities(text.slice(end + 1, close))
    at = close + 1
  }

  return attributes
}

const namedEntities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text

  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)

      // Not a code point: left as written. A throw here is not a protocol error and would end the connection.
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }

    return namedEntities[entity] ?? whole
  })
}

const updateKinds = { Number: 'number', Switch: 'switch', Text: 'text', Light: 'light' } as const
const definitionKinds = { ...updateKinds, BLOB: 'blob' } as const

function toMessage(node: Node, dropped: IndiProtocolError[]): IndiMessage | undefined {
  const a = node.attributes
  const definition = /^def(Number|Switch|Text|Light|BLOB)Vector$/.exec(node.tag)
  const update = /^set(Number|Switch|Text|Light)Vector$/.exec(node.tag)

  if (definition) return { type: 'def', vector: toDefinition(node, definitionKinds[definition[1] as keyof typeof definitionKinds], dropped) }
  if (update) return { type: 'set', vector: toUpdate(node, updateKinds[update[1] as keyof typeof updateKinds], dropped) }

  switch (node.tag) {
    case 'delProperty':
      return a.name === undefined ? { type: 'del', device: identity(a, 'device') } : { type: 'del', device: identity(a, 'device'), name: a.name }
    case 'pingRequest':
      return { type: 'pingRequest', uid: a.uid ?? '' }
    case 'message':
      return a.device === undefined ? { type: 'message', text: a.message ?? '' } : { type: 'message', device: a.device, text: a.message ?? '' }
    default:
      if (/^new(Number|Switch|Text|BLOB)Vector$/.test(node.tag)) return undefined

      throw new IndiProtocolError(`Unknown INDI element <${node.tag}>`)
  }
}

function toDefinition(node: Node, kind: PropertyKind, dropped: IndiProtocolError[]): VectorDefinition {
  const a = node.attributes
  const elements = namedChildren(node, dropped).map(child => toElementDefinition(child, kind))

  return {
    device: identity(a, 'device'),
    name: identity(a, 'name'),
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
  const name = identity(a, 'name')
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
      return { kind, name, label, on: parseSwitch(text) }
    case 'text':
      // indiserver pretty-prints values ("\nRGGB\n    "); the value is the trimmed text.
      return { kind, name, label, value: text }
    case 'light':
      return { kind, name, label, state: parseState(text) }
    case 'blob':
      return { kind, name, label }
  }
}

function toUpdate(node: Node, kind: Exclude<PropertyKind, 'blob'>, dropped: IndiProtocolError[]): VectorUpdate {
  const a = node.attributes
  const elements: ElementUpdate[] = namedChildren(node, dropped).map(child => {
    const name = identity(child.attributes, 'name')
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
        return { kind, name, on: parseSwitch(text) }
      case 'text':
        return { kind, name, value: text }
      case 'light':
        return { kind, name, state: parseState(text) }
    }
  })

  return {
    device: identity(a, 'device'),
    name: identity(a, 'name'),
    kind,
    ...(a.state === undefined ? {} : { state: parseState(a.state) }),
    ...(a.message === undefined ? {} : { message: a.message }),
    elements,
  }
}

/** A device or property or element name: without one the value can't be put anywhere, so empty counts as missing. */
function identity(attributes: Readonly<Record<string, string>>, name: string): string {
  const fault = identityFault(attributes, name)

  if (fault) throw new IndiProtocolError(fault)

  return attributes[name]!
}

function identityFault(attributes: Readonly<Record<string, string>>, name: string): string | undefined {
  const value = attributes[name]

  if (value === undefined) return `INDI element is missing ${name}`
  if (value === '') return `INDI element has an empty ${name}`

  return undefined
}

/** INDI switches are exactly On or Off; a driver that says anything else is not telling us which. */
function parseSwitch(text: string): boolean {
  if (text === 'On') return true
  if (text === 'Off') return false
  throw new IndiProtocolError(`Unknown INDI switch value "${text.slice(0, 20)}"`)
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

export type IndiRequest =
  | { readonly type: 'getProperties'; readonly device?: string; readonly name?: string }
  | { readonly type: 'new'; readonly kind: 'number' | 'switch' | 'text'; readonly device: string; readonly name: string; readonly values: Readonly<Record<string, number | boolean | string>> }
  | { readonly type: 'pingReply'; readonly uid: string }

export function serialize(request: IndiRequest): string {
  switch (request.type) {
    case 'getProperties':
      return `<getProperties version="1.7"${attribute('device', request.device)}${attribute('name', request.name)}/>\n`
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
