import { readWireBody, type WireBody } from '../stream/entry.ts'
import { parseRecord } from '../stream/json.ts'
import { makeReplay, type Reading } from './replay.ts'

const problemEvents = new Set(['phd2.StarLost', 'phd2.Alert', 'phd2.CalibrationFailed'])

interface Classified {
  readonly source: string
  readonly problem: boolean
  readonly command: boolean
  readonly group: string | undefined
  readonly wire: WireBody | undefined
}

export interface ReadEntry {
  readonly v: number
  readonly kind: string
  readonly at: number
  readonly body: unknown
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

export function readEntry(text: string): ReadEntry | undefined {
  const entry = parseRecord(text)

  if (entry === undefined || (entry['v'] !== 1 && entry['v'] !== 2) || typeof entry['kind'] !== 'string' || typeof entry['at'] !== 'number') return undefined

  return { v: entry['v'], kind: entry['kind'], at: entry['at'], body: entry['body'] }
}

function classifyWire(subject: string, body: unknown): Classified | undefined {
  const wire = readWireBody(body)

  if (wire === undefined) {
    const source = /^rig-dev\.wire\.([^.]+)\.(?:in|out)$/.exec(subject)?.[1]

    return source === undefined ? undefined : { source, problem: false, command: false, group: undefined, wire: undefined }
  }

  return {
    source: wire.device,
    problem: (wire.type === 'set' && wire.state === 'Alert') || (wire.type === 'message' && (wire.text ?? '').includes('[ERROR]')),
    command: wire.type === 'new',
    group: (wire.type === 'def' || wire.type === 'set' || wire.type === 'del') && wire.indiDevice !== undefined && wire.property !== undefined ? `${wire.indiDevice}.${wire.property}` : undefined,
    wire,
  }
}

export function classify(subject: string, entry: ReadEntry): Classified | undefined {
  const { kind, body } = entry

  if (kind === 'wire') return classifyWire(subject, body)
  if (kind === 'system') {
    return { source: 'system', command: false, problem: isRecord(body) && Number(body['PRIORITY']) <= 3, group: undefined, wire: undefined }
  }

  if (kind.startsWith('client.')) {
    const target = isRecord(body) && typeof body['target'] === 'string' ? `.${body['target']}` : ''

    return { source: 'client', command: false, problem: false, group: `${kind}${target}`, wire: undefined }
  }

  return { source: 'phd2', command: false, problem: problemEvents.has(kind), group: kind, wire: undefined }
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
  readonly subject: string
  readonly text: string
}

interface Delivered extends Raw {
  readonly at: number
  readonly problem: boolean
  readonly command: boolean
  readonly group: string | undefined
  readonly differs: boolean
  readonly current: Reading | undefined
}

interface Group {
  readonly group: string
  readonly latest: Delivered
  readonly reads: number
  readonly changes: number
  readonly changedAt: number | undefined
  readonly current: Reading | undefined
}

export function makeHistory(query: HistoryQuery, keep: number) {
  const kept: Array<Delivered> = []
  const replay = makeReplay()
  const groups = new Map<string, Group>()
  let run: unknown
  let counts: Record<string, number> = {}
  let scanned = 0
  let matched = 0

  const count = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1
  }

  function restart(entry: ReadEntry) {
    if (!isRecord(entry.body)) return
    if (entry.kind === 'client.connection' && entry.body['target'] === 'indiserver') replay.reset()
    if (entry.kind === 'client.connected' && entry.body['run'] !== run) {
      run = entry.body['run']
      replay.reset()
    }
  }

  return {
    take(raw: Raw): Delivered | undefined {
      const entry = readEntry(raw.text)

      if (entry === undefined) return undefined
      if ((query.since !== undefined && entry.at < query.since) || (query.until !== undefined && entry.at > query.until)) return undefined

      const classified = classify(raw.subject, entry)

      if (classified === undefined) return undefined

      restart(entry)
      scanned += 1
      count(classified.source)
      if (classified.command) count('commands')
      if (classified.problem) count('problems')

      const replayed = classified.wire === undefined ? undefined : replay.apply(classified.wire)
      const changed = replayed === undefined || replayed.changed
      const differs = replayed !== undefined && replayed.known && replayed.changed
      const delivered = { ...raw, at: entry.at, problem: classified.problem, command: classified.command, group: classified.group, differs, current: replayed?.current }

      if (changed) count('changes')

      if (classified.group !== undefined) {
        const known = groups.get(classified.group)

        groups.set(classified.group, {
          group: classified.group,
          latest: delivered,
          reads: (known?.reads ?? 0) + 1,
          changes: (known?.changes ?? 0) + (differs ? 1 : 0),
          changedAt: differs ? entry.at : known?.changedAt,
          current: delivered.current,
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
