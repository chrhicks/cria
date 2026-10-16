import { createHash } from 'node:crypto'

export const failedStep = 'scenario failed'

export interface Entry {
  readonly scenario: string
  readonly step: number
  readonly request: string
  readonly sent?: unknown
  readonly status: number
  readonly body: unknown
}

export interface Recorded {
  readonly request: string
  readonly sent?: unknown
  readonly status: number
  body: unknown
}

export function recordingFetch(into: Recorded[]): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    const url = new URL(String(input))
    const type = response.headers.get('content-type') ?? ''
    const entry: Recorded = {
      request: `${init?.method ?? 'GET'} ${url.pathname}`,
      ...(typeof init?.body === 'string' ? { sent: JSON.parse(init.body) } : {}),
      status: response.status,
      body: { contentType: type },
    }

    into.push(entry)
    if (type === 'application/json') entry.body = await response.clone().json()
    if (type === 'application/imagebytes') {
      const bytes = Buffer.from(await response.clone().arrayBuffer())

      entry.body = {
        contentType: type,
        contentLength: response.headers.get('content-length'),
        etag: response.headers.get('etag'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
    }

    return response
  }
}

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const utc = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/g
const times = new Set(['acceptedAt', 'startedAt', 'settledAt', 'observedAt', 'generatedAt', 'since', 'commandedAt', 'capturedAt', 'retainedAt', 'at'])
const labels: Record<string, string> = {
  instanceId: 'instance',
  bindingId: 'binding',
  requestId: 'request',
  operationId: 'operation',
  afterOperation: 'operation',
  url: 'image',
}

function labelOf(key: string, parent: object): string {
  if (key === 'id' && 'requestId' in parent) return 'operation'
  if (key === 'id' && 'sha256' in parent) return 'image'

  return labels[key] ?? 'id'
}

export function normalize(scenario: string, recorded: ReadonlyArray<Recorded>): Entry[] {
  const names = new Map<string, string>()
  const counts = new Map<string, number>()

  const name = (id: string, label: string) => {
    const known = names.get(id)

    if (known) return known
    const count = (counts.get(label) ?? 0) + 1

    counts.set(label, count)
    names.set(id, `<${label}-${count}>`)

    return `<${label}-${count}>`
  }

  const visit = (value: unknown, key: string, parent: object): unknown => {
    if (Array.isArray(value)) return value.map(item => visit(item, key, parent))
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(inner => [inner, visit((value as Record<string, unknown>)[inner], inner, value)]),
      )
    if (typeof value === 'number' && times.has(key)) return '<time>'
    if (typeof value === 'number' && key === 'elapsedSeconds') return '<elapsed>'
    if (typeof value === 'number' && key === 'sequence') return '<sequence>'
    if (typeof value === 'string' && value.length > 1000) return `<${value.length} characters>`
    if (typeof value === 'string') return value.replace(uuid, id => name(id, labelOf(key, parent))).replace(utc, '<utc>')

    return value
  }

  return recorded.map((entry, index) => ({
    scenario,
    step: index + 1,
    request: visit(entry.request, 'request', {}) as string,
    ...(entry.sent === undefined ? {} : { sent: visit(entry.sent, 'sent', {}) }),
    status: entry.status,
    body: visit(entry.body, 'body', {}),
  }))
}

export function diff(expected: ReadonlyArray<Entry>, actual: ReadonlyArray<Entry>): string[] {
  const group = (entries: ReadonlyArray<Entry>) => {
    const groups = new Map<string, Entry[]>()

    for (const entry of entries) groups.set(entry.scenario, [...(groups.get(entry.scenario) ?? []), entry])

    return groups
  }
  const want = group(expected)
  const got = group(actual)
  const report: string[] = []

  for (const scenario of new Set([...want.keys(), ...got.keys()])) {
    const before = want.get(scenario)
    const after = got.get(scenario)

    if (!before) {
      report.push(`scenario "${scenario}": new, not in the golden`)
      continue
    }
    if (!after) {
      report.push(`scenario "${scenario}": in the golden, did not run`)
      continue
    }

    for (let step = 0; step < Math.max(before.length, after.length); step++) {
      const want = before[step]
      const got = after[step]

      if (got?.request === failedStep || !got) {
        if (got) report.push(`scenario "${scenario}", step ${step + 1}: the scenario stopped: ${String(got.body)}`)
        if (before.length > step) report.push(`scenario "${scenario}": golden steps ${step + 1} to ${before.length} did not run`)
        break
      }
      if (!want) {
        report.push(`scenario "${scenario}", step ${step + 1} (${got.request}): not in the golden`)
        continue
      }

      const lines: string[] = []

      compare(want, got, '', lines)
      if (lines.length > 0) report.push(`scenario "${scenario}", step ${step + 1} (${got.request}):`, ...lines.map(line => `  ${line}`))
    }
  }

  return report
}

function compare(expected: unknown, actual: unknown, path: string, lines: string[]) {
  if (isObject(expected) && isObject(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      const inner = Array.isArray(expected) ? `${path}[${key}]` : path ? `${path}.${key}` : key

      if (!(key in actual)) lines.push(`${inner}: missing (golden has ${show(expected[key])})`)
      else if (!(key in expected)) lines.push(`${inner}: unexpected ${show(actual[key])}`)
      else compare(expected[key], actual[key], inner, lines)
    }

    return
  }

  if (JSON.stringify(expected) !== JSON.stringify(actual)) lines.push(`${path}: golden ${show(expected)}, got ${show(actual)}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? 'nothing'

  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}
