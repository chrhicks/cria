import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { Result, Schema } from 'effect'
import { parseRecord } from '../stream/json.ts'

const fields = {
  from: Schema.Number,
  to: Schema.Number,
  title: Schema.String,
  note: Schema.String,
  search: Schema.String,
  by: Schema.optionalKey(Schema.String),
}

const NewHighlight = Schema.Struct(fields)

export const Highlight = Schema.Struct({ id: Schema.String, ...fields })

export type Highlight = typeof Highlight.Type

const HighlightsFile = Schema.Struct({ highlights: Schema.Array(Highlight) })

export type Listed =
  | { readonly status: 'listed'; readonly highlights: ReadonlyArray<Highlight> }
  | { readonly status: 'unreadable'; readonly reason: string }

export type Added =
  | { readonly status: 'saved'; readonly highlight: Highlight }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'unreadable'; readonly reason: string }

const strictly = { onExcessProperty: 'error' } as const

function save(file: string, highlights: ReadonlyArray<Highlight>) {
  const next = `${file}.next`

  mkdirSync(dirname(file), { recursive: true })
  const handle = openSync(next, 'w')
  writeSync(handle, `${JSON.stringify({ highlights }, null, 1)}\n`)
  fsyncSync(handle)
  closeSync(handle)
  renameSync(next, file)
}

export function makeHighlights(file: string) {
  function list(): Listed {
    if (!existsSync(file)) return { status: 'listed', highlights: [] }

    const read = Schema.decodeUnknownResult(HighlightsFile, strictly)(parseRecord(readFileSync(file, 'utf8')))

    return Result.isSuccess(read)
      ? { status: 'listed', highlights: read.success.highlights }
      : { status: 'unreadable', reason: `${file} is not a list of highlights: ${String(read.failure)}` }
  }

  function add(text: string): Added {
    const asked = Schema.decodeUnknownResult(NewHighlight, strictly)(parseRecord(text))

    if (Result.isFailure(asked)) return { status: 'refused', reason: String(asked.failure) }

    const known = list()

    if (known.status === 'unreadable') return known

    const { from, to } = asked.success
    const highlight = { ...asked.success, id: randomUUID(), from: Math.min(from, to), to: Math.max(from, to) }

    save(file, [...known.highlights, highlight])

    return { status: 'saved', highlight }
  }

  return { list, add }
}
