/**
 * What indiserver sent, read from the wire text a recording keeps. Written for
 * libindi's output (machine-made, entity-escaped, no comments) and independent
 * of `@cria/indi`'s parser, as `@cria/fake-indi` is. Anything it does not
 * model (a ping reply, a command another client sent) reads as `undefined` and is not replayed.
 */
import type { FakeElement, FakeVector, Limits, Value } from '@cria/fake-indi'

export type VectorKind = FakeVector['kind']

/** A property as a driver defined it: the same shape `FakeIndi.define` takes. */
export type Definition = Omit<FakeVector, 'state'> & { readonly state: FakeVector['state'] }

/**
 * What a driver said. A `message` is the driver's text riding on that one definition, update, image or deletion,
 * or, as `kind: 'message'`, a `<message>` on its own: for one device or, without a device, for everyone.
 */
export type ServerElement =
  | { readonly kind: 'define'; readonly vector: Definition; readonly message?: string }
  | { readonly kind: 'update'; readonly device: string; readonly name: string; readonly state?: FakeVector['state']; readonly values: Readonly<Record<string, Value>>; readonly limits?: Limits; readonly timeout?: number; readonly message?: string }
  | { readonly kind: 'image'; readonly device: string; readonly name: string; readonly timeout?: number; readonly message?: string; readonly images: ReadonlyArray<{ readonly element: string; readonly ref: string | undefined; readonly size: number | undefined; readonly format: string }> }
  | { readonly kind: 'delete'; readonly device: string; readonly name: string | undefined; readonly message?: string }
  | { readonly kind: 'message'; readonly device: string | undefined; readonly text: string | undefined }

/** The `getProperties` a client sent, which a driver answers with definitions; undefined for anything else. */
export function parseClientAsk(xml: string): { readonly device: string | undefined; readonly name: string | undefined } | undefined {
  const head = /^\s*<getProperties\b([^>]*?)\/?>/.exec(xml)

  if (!head) return undefined
  const { device, name } = attributes(head[1]!)

  return { device, name }
}

const kinds: Record<string, VectorKind> = { Number: 'number', Switch: 'switch', Text: 'text', Light: 'light', BLOB: 'blob' }
const states = new Set(['Idle', 'Ok', 'Busy', 'Alert'])
const perms = new Set(['ro', 'rw', 'wo'])
const rules = new Set(['OneOfMany', 'AnyOfMany', 'AtMostOne'])

export function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!)
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1]!, unescapeXml(match[2]!)]))
}

const number = (text: string | undefined): number | undefined => (text === undefined || text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text))

const limit = (key: 'min' | 'max' | 'step', text: string | undefined) => (number(text) === undefined ? {} : { [key]: number(text)! })

function elementValue(kind: VectorKind, text: string): Value {
  const trimmed = unescapeXml(text).trim()

  return kind === 'switch' ? trimmed === 'On' : trimmed
}

export function parseServerElement(xml: string): ServerElement | undefined {
  const head = /^\s*<(def|set)(Number|Switch|Text|Light|BLOB)Vector\b([^>]*)>/.exec(xml)

  if (head) {
    const verb = head[1]!
    const kind = kinds[head[2]!]!
    const vector = attributes(head[3]!)

    if (vector.device === undefined || vector.name === undefined) return undefined

    return verb === 'def' ? definition(xml, kind, vector) : update(xml, kind, vector)
  }

  const deletion = /^\s*<delProperty\b([^>]*?)\/?>/.exec(xml)

  if (deletion) {
    const { device, name, message } = attributes(deletion[1]!)

    return device === undefined ? undefined : { kind: 'delete', device, name, ...(message === undefined ? {} : { message }) }
  }

  const standalone = /^\s*<message\b([^>]*?)\/?>/.exec(xml)

  if (standalone) {
    const { device, message } = attributes(standalone[1]!)

    return { kind: 'message', device, text: message }
  }

  return undefined
}

function definition(xml: string, kind: VectorKind, vector: Record<string, string>): ServerElement | undefined {
  const tag = { number: 'Number', switch: 'Switch', text: 'Text', light: 'Light', blob: 'BLOB' }[kind]
  const elements: Record<string, FakeElement> = {}

  for (const match of xml.matchAll(new RegExp(`<def${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</def${tag}>)`, 'g'))) {
    const attribute = attributes(match[1]!)

    if (attribute.name === undefined) return undefined
    const min = number(attribute.min)
    const max = number(attribute.max)
    const step = number(attribute.step)

    elements[attribute.name] = {
      value: kind === 'blob' ? '' : elementValue(kind, match[2] ?? ''),
      ...(attribute.label === undefined ? {} : { label: attribute.label }),
      ...(kind !== 'number' ? {} : { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }), ...(attribute.format === undefined ? {} : { format: attribute.format }) }),
    }
  }

  const state = vector.state && states.has(vector.state) ? (vector.state as FakeVector['state']) : 'Idle'
  const perm = vector.perm && perms.has(vector.perm) ? (vector.perm as FakeVector['perm']) : 'ro'
  const timeout = number(vector.timeout)

  return {
    kind: 'define',
    ...(vector.message === undefined ? {} : { message: vector.message }),
    vector: {
      device: vector.device!,
      name: vector.name!,
      kind,
      perm,
      ...(vector.rule && rules.has(vector.rule) ? { rule: vector.rule as NonNullable<FakeVector['rule']> } : {}),
      ...(vector.label === undefined ? {} : { label: vector.label }),
      ...(vector.group === undefined ? {} : { group: vector.group }),
      timeout: timeout ?? 0,
      state,
      elements,
    },
  }
}

function update(xml: string, kind: VectorKind, vector: Record<string, string>): ServerElement | undefined {
  const state = vector.state && states.has(vector.state) ? (vector.state as FakeVector['state']) : undefined

  if (kind === 'blob') {
    const images = [...xml.matchAll(/<oneBLOB\b([^>]*?)(?:\/>|>)/g)].map(match => {
      const attribute = attributes(match[1]!)

      return { element: attribute.name ?? '', ref: attribute.ref, size: number(attribute.size), format: attribute.format ?? '' }
    })

    const timeout = number(vector.timeout)

    return { kind: 'image', device: vector.device!, name: vector.name!, ...(timeout === undefined ? {} : { timeout }), ...(vector.message === undefined ? {} : { message: vector.message }), images }
  }

  const tag = { number: 'Number', switch: 'Switch', text: 'Text', light: 'Light' }[kind]
  const values: Record<string, Value> = {}
  const limits: Limits = {}

  for (const match of xml.matchAll(new RegExp(`<one${tag}\\b([^>]*?)>([\\s\\S]*?)</one${tag}>`, 'g'))) {
    const { name, min, max, step } = attributes(match[1]!)

    if (name === undefined) continue
    values[name] = elementValue(kind, match[2]!)
    if (kind !== 'number') continue
    const changed = { ...limit('min', min), ...limit('max', max), ...limit('step', step) }

    if (Object.keys(changed).length > 0) limits[name] = changed
  }

  const timeout = number(vector.timeout)

  return {
    kind: 'update',
    device: vector.device!,
    name: vector.name!,
    ...(state ? { state } : {}),
    values,
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(timeout === undefined ? {} : { timeout }),
    ...(vector.message === undefined ? {} : { message: vector.message }),
  }
}
