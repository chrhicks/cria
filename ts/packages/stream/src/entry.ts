import type { Direction } from '@cria/indi'
import { Option, Schema } from 'effect'

export interface Entry {
  readonly v: 1
  readonly id: string
  readonly rig: string
  readonly kind: string
  readonly at: number
  readonly source: string
  readonly tags: ReadonlyArray<string>
  readonly body: unknown
}

export interface EntryContext {
  readonly rig: string
  readonly source: string
  readonly run: string
  readonly now: () => number
}

const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

function stringField(record: Readonly<Record<string, unknown>>, name: string) {
  const value = record[name]

  return typeof value === 'string' ? value : undefined
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
  let criaCount = 0

  const entry = (kind: string, id: string, at: number, body: unknown): Entry => ({
    v: 1,
    id,
    rig,
    kind,
    at,
    source,
    tags: [],
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

      const record = decodeRecord(line)

      if (Option.isNone(record)) return entry('system', `system:${run}:${systemCount}`, now(), line)

      const cursor = stringField(record.value, '__CURSOR')
      const microseconds = finite(record.value['__REALTIME_TIMESTAMP'])

      return entry(
        'system',
        cursor === undefined ? `system:${run}:${systemCount}` : `system:${cursor}`,
        microseconds === undefined ? now() : Math.round(microseconds / 1000),
        record.value,
      )
    },

    client(kind: string, body: unknown) {
      clientCount += 1

      return entry(`client.${kind}`, `client:${run}:${clientCount}`, now(), body)
    },

    cria(kind: string, body: unknown) {
      criaCount += 1

      return entry(`cria.${kind}`, `cria:${run}:${criaCount}`, now(), body)
    },

    phd2(line: string) {
      phd2Count += 1

      const id = `phd2:${run}:${phd2Count}`
      const record = decodeRecord(line)

      if (Option.isNone(record)) return entry('phd2.unknown', id, now(), line)

      const seconds = finite(record.value['Timestamp'])

      return entry(
        `phd2.${stringField(record.value, 'Event') ?? 'unknown'}`,
        id,
        seconds === undefined ? now() : Math.round(seconds * 1000),
        record.value,
      )
    },
  }
}
