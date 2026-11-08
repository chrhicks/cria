import type { View } from './view.ts'

const fields = ['who', 'what', 'prop', 'state', 'kind', 'id', 'src'] as const

type Field = (typeof fields)[number]

interface Term {
  readonly wanted: string
  readonly field: Field | undefined
  readonly excluded: boolean
}

export type Search = ReadonlyArray<Term>

export interface Searched {
  readonly view: View
  readonly kind: string
  readonly id: string
  readonly text: string
}

function fieldOf(name: string) {
  return fields.find(field => field === name)
}

function termOf(word: string): Term {
  const excluded = word.startsWith('-') && word.length > 1
  const rest = excluded ? word.slice(1) : word
  const split = /^(\w+):(.+)$/.exec(rest)
  const field = split?.[1] === undefined ? undefined : fieldOf(split[1])

  return field === undefined ? { wanted: rest, field: undefined, excluded } : { wanted: split?.[2] ?? '', field, excluded }
}

export function parseSearch(words: string): Search {
  return words.toLowerCase().split(/\s+/).filter(Boolean).map(termOf)
}

function valueOf(field: Field, { view, kind, id }: Searched) {
  switch (field) {
    case 'who': return view.who
    case 'what': return view.what
    case 'prop': return view.what
    case 'state': return view.state
    case 'kind': return kind
    case 'id': return id
    case 'src': return view.label
  }
}

export function matches(search: Search, searched: Searched) {
  if (search.length === 0) return true

  const { view, text } = searched
  const everything = `${view.who} ${view.what} ${view.state} ${text}`.toLowerCase()

  return search.every(term => {
    const found = term.field === undefined ? everything.includes(term.wanted) : valueOf(term.field, searched).toLowerCase().includes(term.wanted)

    return found !== term.excluded
  })
}
