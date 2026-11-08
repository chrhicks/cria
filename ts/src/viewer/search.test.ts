import { describe, expect, it } from 'vitest'
import { matches, parseSearch, type Searched } from './search.ts'
import type { View } from './view.ts'

const view: View = { source: 'mount', who: 'mount', label: 'cmd', what: 'TELESCOPE_ABORT_MOTION', state: 'Busy', pairs: [], text: '', quiet: false }
const searched: Searched = { view, kind: 'wire', id: 'wire:run-1:out:7', text: '{"xml":"<newSwitchVector device=\\"ZWO AM5\\">"}' }

const finds = (words: string) => matches(parseSearch(words), searched)

describe('search', () => {
  it('finds everything when there is nothing to search for', () => {
    expect(finds('')).toBe(true)
    expect(finds('   ')).toBe(true)
  })

  it('finds a word in the row or anywhere in the entry, whatever its case', () => {
    expect(finds('abort')).toBe(true)
    expect(finds('busy')).toBe(true)
    expect(finds('zwo am5')).toBe(true)
    expect(finds('parked')).toBe(false)
  })

  it('needs every word', () => {
    expect(finds('abort busy')).toBe(true)
    expect(finds('abort parked')).toBe(false)
  })

  it('leaves out a row with a word after a minus', () => {
    expect(finds('-abort')).toBe(false)
    expect(finds('-parked')).toBe(true)
  })

  it('looks in one field when the word names it', () => {
    expect(finds('what:abort')).toBe(true)
    expect(finds('prop:abort')).toBe(true)
    expect(finds('who:mount')).toBe(true)
    expect(finds('state:busy')).toBe(true)
    expect(finds('state:alert')).toBe(false)
    expect(finds('src:cmd')).toBe(true)
    expect(finds('kind:wire')).toBe(true)
    expect(finds('id:run-1')).toBe(true)
    expect(finds('who:zwo')).toBe(false)
    expect(finds('-state:busy')).toBe(false)
  })

  it('reads a word with a colon that names no field as a plain word', () => {
    expect(matches(parseSearch('port:7624'), { ...searched, text: 'listening on port:7624' })).toBe(true)
    expect(finds('foo:bar')).toBe(false)
  })
})
