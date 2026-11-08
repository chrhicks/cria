import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeHighlights, type Added } from './highlights.ts'

const folders: Array<string> = []

function store() {
  const folder = mkdtempSync(join(tmpdir(), 'highlights-'))
  const file = join(folder, 'state', 'highlights.json')

  folders.push(folder)

  return { file, highlights: makeHighlights(file) }
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const asked = { from: 100, to: 200, title: 'Stop gets no answer', note: 'Search ABORT', search: 'abort' }

function saved(added: Added) {
  if (added.status !== 'saved') throw new Error(`not saved: ${added.reason}`)

  return added.highlight
}

describe('highlights', () => {
  it('has none before the first is saved', () => {
    expect(store().highlights.list()).toEqual({ status: 'listed', highlights: [] })
  })

  it('saves a highlight with an id, and lists it again from the file', () => {
    const { file, highlights } = store()
    const made = saved(highlights.add(JSON.stringify({ ...asked, by: 'observer' })))

    expect(made).toMatchObject({ ...asked, by: 'observer' })
    expect(made.id).not.toBe('')
    expect(makeHighlights(file).list()).toEqual({ status: 'listed', highlights: [made] })
  })

  it('keeps every highlight in the order they were saved', () => {
    const { highlights } = store()

    highlights.add(JSON.stringify(asked))
    highlights.add(JSON.stringify({ ...asked, title: 'second' }))

    const listed = highlights.list()

    expect(listed.status === 'listed' && listed.highlights.map(highlight => highlight.title)).toEqual(['Stop gets no answer', 'second'])
  })

  it('puts the ends in order when they were picked backwards', () => {
    expect(saved(store().highlights.add(JSON.stringify({ ...asked, from: 200, to: 100 })))).toMatchObject({ from: 100, to: 200 })
  })

  it('refuses a highlight that is not JSON, lacks a field or has one it does not know, and saves nothing', () => {
    const { highlights } = store()

    expect(highlights.add('not json').status).toBe('refused')
    expect(highlights.add(JSON.stringify({ from: 1 })).status).toBe('refused')
    expect(highlights.add(JSON.stringify({ ...asked, colour: 'amber' })).status).toBe('refused')
    expect(highlights.list()).toEqual({ status: 'listed', highlights: [] })
  })

  it('says so when the file is not a list of highlights, and leaves it as it is', () => {
    const { file, highlights } = store()

    highlights.add(JSON.stringify(asked))
    writeFileSync(file, '[1, 2]')

    expect(highlights.list().status).toBe('unreadable')
    expect(highlights.add(JSON.stringify(asked)).status).toBe('unreadable')
    expect(readFileSync(file, 'utf8')).toBe('[1, 2]')
  })
})
