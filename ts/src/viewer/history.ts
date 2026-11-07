import { Option, Schema } from 'effect'

const decodeEntry = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ v: Schema.Literal(1), kind: Schema.String, body: Schema.Unknown })),
)

const problemEvents = new Set(['phd2.StarLost', 'phd2.Alert', 'phd2.CalibrationFailed'])

export interface Classified {
  readonly source: string
  readonly problem: boolean
  readonly command: boolean
  readonly property: string | undefined
  readonly reading: string | undefined
  readonly group: string | undefined
}

const valueElement = /<(?:one|def)(?:Number|Text|Switch|Light)\b[^>]*?\bname="([^"]*)"[^>]*>([^<]*)</g

function readingOf(xml: string, state: string | undefined) {
  const values = [...xml.matchAll(valueElement)].map(([, name, value]) => `${name}=${(value ?? '').trim()}`)

  return `${state ?? ''} ${values.join(' ')}`
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function classifyWire(subject: string, body: unknown): Classified | undefined {
  const source = /^rig-dev\.wire\.(\w+)\.(?:in|out)$/.exec(subject)?.[1]

  if (source === undefined) return undefined

  const xml = isRecord(body) && typeof body['xml'] === 'string' ? body['xml'] : ''
  const firstTag = /^\s*<(\w+)[^>]*>?/.exec(xml)
  const tag = firstTag?.[1] ?? ''
  const state = /\bstate="(\w+)"/.exec(firstTag?.[0] ?? '')?.[1]
  const name = /\bname="([^"]*)"/.exec(firstTag?.[0] ?? '')?.[1]
  const carriesValues = name !== undefined && name !== '' && (tag.startsWith('set') || tag.startsWith('def'))

  return {
    source,
    property: carriesValues ? `${source}.${name}` : undefined,
    reading: carriesValues ? readingOf(xml, state) : undefined,
    group: carriesValues ? `${source}.${name}` : undefined,
    command: tag.startsWith('new'),
    problem: (tag.startsWith('set') && state === 'Alert') || (tag === 'message' && xml.includes('[ERROR]')),
  }
}

export function classify(subject: string, text: string): Classified | undefined {
  const entry = decodeEntry(text)

  if (Option.isNone(entry)) return undefined

  const { kind, body } = entry.value

  if (kind === 'wire') return classifyWire(subject, body)
  if (kind === 'system') {
    return { source: 'system', command: false, problem: isRecord(body) && Number(body['PRIORITY']) <= 3, property: undefined, reading: undefined, group: undefined }
  }

  if (kind.startsWith('client.')) {
    const target = isRecord(body) && typeof body['target'] === 'string' ? `.${body['target']}` : ''

    return { source: 'client', command: false, problem: false, property: undefined, reading: undefined, group: `${kind}${target}` }
  }

  return { source: 'phd2', command: false, problem: problemEvents.has(kind), property: undefined, reading: undefined, group: kind }
}

export interface HistoryQuery {
  readonly since: number | undefined
  readonly until: number | undefined
  readonly show: ReadonlySet<string>
  readonly commands: boolean
  readonly problems: boolean
  readonly changes: boolean
  readonly table: boolean
}

function time(value: string | null) {
  const parsed = Number(value)

  return value !== null && value !== '' && Number.isFinite(parsed) ? parsed : undefined
}

export function parseQuery(parameters: URLSearchParams): HistoryQuery {
  return {
    since: time(parameters.get('since')),
    until: time(parameters.get('until')),
    show: new Set((parameters.get('show') ?? '').split(',').filter(Boolean)),
    commands: parameters.has('commands'),
    problems: parameters.has('problems'),
    changes: parameters.has('changes'),
    table: parameters.has('table'),
  }
}

export interface Raw {
  readonly seq: number
  readonly at: number
  readonly subject: string
  readonly text: string
}

export interface Delivered extends Raw {
  readonly problem: boolean
  readonly command: boolean
  readonly group: string | undefined
  readonly differs: boolean
}

export interface Group {
  readonly group: string
  readonly latest: Delivered
  readonly reads: number
  readonly changes: number
  readonly changedAt: number | undefined
}

export function makeHistory(query: HistoryQuery, keep: number) {
  const kept: Array<Delivered> = []
  const readings = new Map<string, string>()
  const groups = new Map<string, Group>()
  let counts: Record<string, number> = {}
  let scanned = 0
  let matched = 0

  const count = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1
  }

  return {
    take(raw: Raw): Delivered | undefined {
      const classified = classify(raw.subject, raw.text)

      if (classified === undefined) return undefined

      scanned += 1
      count(classified.source)
      if (classified.command) count('commands')
      if (classified.problem) count('problems')

      const { property, reading } = classified
      const previous = property === undefined ? undefined : readings.get(property)
      const changed = property === undefined || previous !== reading
      const differs = property !== undefined && previous !== undefined && previous !== reading
      const delivered = { ...raw, problem: classified.problem, command: classified.command, group: classified.group, differs }

      if (property !== undefined && reading !== undefined) readings.set(property, reading)
      if (changed) count('changes')

      if (classified.group !== undefined) {
        const known = groups.get(classified.group)

        groups.set(classified.group, {
          group: classified.group,
          latest: delivered,
          reads: (known?.reads ?? 0) + 1,
          changes: (known?.changes ?? 0) + (differs ? 1 : 0),
          changedAt: differs ? raw.at : known?.changedAt,
        })
      }

      if (query.table) return delivered
      if (query.changes && !changed) return undefined
      if (query.show.size > 0 && !query.show.has(classified.source)) return undefined
      if (query.commands && !classified.command) return undefined
      if (query.problems && !classified.problem) return undefined

      matched += 1
      kept.push(delivered)
      if (kept.length > keep) kept.shift()

      return delivered
    },

    counted() {
      const now = { counts, scanned, matched }

      counts = {}
      scanned = 0
      matched = 0

      return now
    },

    drained() {
      return kept.splice(0)
    },

    groups() {
      return [...groups.values()]
    },
  }
}
