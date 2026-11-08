import { readWireBody } from '../stream/entry.ts'
import type { ReadEntry } from './history.ts'
import type { Reading } from './replay.ts'

export interface View {
  readonly source: string
  readonly who: string
  readonly label: string
  readonly what: string
  readonly state: string
  readonly pairs: ReadonlyArray<readonly [string, string]>
  readonly text: string
  readonly quiet: boolean
}

type Fields = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function shown(value: unknown) {
  if (typeof value === 'number') return String(Number(value.toFixed(6)))
  if (value === true) return 'On'

  if (value === undefined) return ''

  return typeof value === 'string' ? value : JSON.stringify(value)
}

function pairsOf(values: Fields | undefined): ReadonlyArray<readonly [string, string]> {
  return Object.entries(values ?? {})
    .filter(([, value]) => value !== false)
    .map(([key, value]) => [key, shown(value)])
}

function wireView(entry: ReadEntry, subject: string, current: Reading | undefined): View {
  const wire = readWireBody(entry.body)

  if (wire === undefined) {
    const device = subject.split('.')[2] ?? ''
    const body = isRecord(entry.body) ? entry.body : {}

    return { source: device, who: device, label: text(body['dir']) ?? '', what: '', state: '', pairs: [], text: (text(body['xml']) ?? '').trim(), quiet: true }
  }

  const reading = current ?? wire
  const base = {
    source: wire.device,
    who: wire.device,
    label: wire.dir,
    what: wire.property ?? wire.tag ?? wire.type,
    state: reading.state ?? '',
    pairs: pairsOf(reading.elements),
    text: '',
    quiet: false,
  }

  switch (wire.type) {
    case 'message': return { ...base, what: 'message', text: wire.text ?? '', quiet: (wire.text ?? '').includes('[DEBUG]') }
    case 'new': return { ...base, label: 'cmd' }
    case 'def': return { ...base, text: base.pairs.length === 0 ? 'defined' : '', quiet: true }
    case 'set': return base
    case 'del': return { ...base, text: 'deleted', quiet: true }
    case 'unreadable': return { ...base, what: 'unreadable', text: wire.text ?? '' }
    default: return { ...base, quiet: true }
  }
}

function systemView(entry: ReadEntry): View {
  const base = { source: 'system', label: 'sys', state: '', pairs: [] }

  if (!isRecord(entry.body)) return { ...base, who: 'journal', what: '', text: shown(entry.body), quiet: false }

  const body = entry.body
  const priority = Number(body['PRIORITY'])

  return {
    ...base,
    who: text(body['SYSLOG_IDENTIFIER']) ?? text(body['_COMM']) ?? 'journal',
    what: text(body['_SYSTEMD_USER_UNIT']) ?? text(body['_SYSTEMD_UNIT']) ?? '',
    text: shown(body['MESSAGE']),
    quiet: priority > 6,
  }
}

function phd2View(entry: ReadEntry): View {
  const base = { source: 'phd2', who: 'phd2', label: 'phd', what: entry.kind.slice('phd2.'.length), state: '', quiet: false }

  if (!isRecord(entry.body)) return { ...base, pairs: [], text: shown(entry.body) }

  const { Event, Timestamp, Host, Inst, ...rest } = entry.body

  return { ...base, pairs: Object.entries(rest).map(([key, value]) => [key, typeof value === 'boolean' ? String(value) : shown(value)]), text: '' }
}

function clientView(entry: ReadEntry): View {
  const body = isRecord(entry.body) ? entry.body : {}
  const base = { source: 'client', who: entry.source.split(':').at(-1) ?? '', label: 'cli', state: '', text: '', quiet: false }

  if (entry.kind === 'client.connection') {
    return { ...base, what: `connection ${text(body['target']) ?? ''}`, state: text(body['status']) ?? '', pairs: [], text: text(body['error']) ?? '' }
  }

  if (entry.kind === 'client.protocol-problem') {
    const optional = (name: string) => {
      const value = text(body[name])

      return value === undefined ? [] : [[name === 'indiDevice' ? 'device' : name, value] as const]
    }

    return {
      ...base,
      what: 'protocol problem',
      state: text(body['scope']) ?? '',
      pairs: [['tag', text(body['tag']) || '–'], ...optional('indiDevice'), ...optional('property'), ['bytes', shown(body['bytes'])]],
      text: `${shown(body['consequence'])}: ${shown(body['reason'])}: ${shown(body['excerpt'])}`,
    }
  }

  const sources = Array.isArray(body['sources']) ? body['sources'].map(shown).join(', ') : ''
  const version = body['version'] === undefined ? [] : [['version', shown(body['version'])] as const]

  return { ...base, what: entry.kind.slice('client.'.length), pairs: [['connection', shown(body['connection'])], ...version, ['sources', sources]] }
}

export function viewOf(entry: ReadEntry, subject: string, current: Reading | undefined): View {
  if (entry.kind === 'wire') return wireView(entry, subject, current)
  if (entry.kind.startsWith('client.')) return clientView(entry)

  return entry.kind === 'system' ? systemView(entry) : phd2View(entry)
}
