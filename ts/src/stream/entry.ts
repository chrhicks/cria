import type { Direction } from '../indi/index.ts'
import { parseRecord, stringField } from './json.ts'

export interface Entry {
  readonly v: 1
  readonly id: string
  readonly rig: string
  readonly kind: string
  readonly at: number
  readonly source: string
  readonly body: unknown
}

export interface EntryContext {
  readonly rig: string
  readonly source: string
  readonly run: string
  readonly now: () => number
}

function finite(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value

  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

export function makeEntries({ rig, source, run, now }: EntryContext) {
  const wireCounts = new Map<string, number>()
  let systemCount = 0
  let phd2Count = 0
  let clientCount = 0

  const entry = (kind: string, id: string, at: number, body: unknown): Entry => ({
    v: 1,
    id,
    rig,
    kind,
    at,
    source,
    body,
  })

  return {
    wire(conn: number, dir: Direction, xml: string) {
      const key = `${conn}:${dir}`
      const n = (wireCounts.get(key) ?? 0) + 1

      wireCounts.set(key, n)

      return entry('wire', `wire:${run}:${key}:${n}`, now(), { conn, dir, n, xml })
    },

    system(line: string) {
      systemCount += 1

      const record = parseRecord(line)

      if (record === undefined) return entry('system', `system:${run}:${systemCount}`, now(), line)

      const cursor = stringField(record, '__CURSOR')
      const microseconds = finite(record['__REALTIME_TIMESTAMP'])

      return entry(
        'system',
        cursor === undefined ? `system:${run}:${systemCount}` : `system:${cursor}`,
        microseconds === undefined ? now() : Math.round(microseconds / 1000),
        record,
      )
    },

    client(kind: string, body: unknown) {
      clientCount += 1

      return entry(`client.${kind}`, `client:${run}:${clientCount}`, now(), body)
    },

    phd2(line: string) {
      phd2Count += 1

      const id = `phd2:${run}:${phd2Count}`
      const record = parseRecord(line)

      if (record === undefined) return entry('phd2.unknown', id, now(), line)

      const seconds = finite(record['Timestamp'])

      return entry(
        `phd2.${stringField(record, 'Event') ?? 'unknown'}`,
        id,
        seconds === undefined ? now() : Math.round(seconds * 1000),
        record,
      )
    },
  }
}
