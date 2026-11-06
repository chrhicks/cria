import { describe, expect, it } from 'vitest'
import { makeEntries } from './entry.js'

function entries() {
  return makeEntries({ rig: 'test-rig', source: 'test:stream-client', run: 'run1', now: () => 1000 })
}

const outer = { v: 1, rig: 'test-rig', source: 'test:stream-client', tags: [] }

describe('wire entries', () => {
  it('keep the raw XML and count each direction of each connection', () => {
    const made = entries()

    expect(made.wire(1, 'in', '<a/>')).toEqual({
      ...outer,
      id: 'wire:run1:1:in:1',
      kind: 'wire',
      at: 1000,
      body: { conn: 1, dir: 'in', n: 1, xml: '<a/>' },
    })
    expect(made.wire(1, 'in', '<b/>').id).toBe('wire:run1:1:in:2')
    expect(made.wire(1, 'out', '<c/>').id).toBe('wire:run1:1:out:1')
    expect(made.wire(2, 'in', '<d/>').id).toBe('wire:run1:2:in:1')
  })
})

describe('system entries', () => {
  it('take their id and time from the journal, so a re-sent line keeps its id', () => {
    const line = JSON.stringify({ __CURSOR: 's=abc', __REALTIME_TIMESTAMP: '1793990186857133', MESSAGE: 'hello' })
    const entry = entries().system(line)

    expect(entry).toEqual({
      ...outer,
      id: 'system:s=abc',
      kind: 'system',
      at: 1793990186857,
      body: { __CURSOR: 's=abc', __REALTIME_TIMESTAMP: '1793990186857133', MESSAGE: 'hello' },
    })
    expect(entries().system(line).id).toBe(entry.id)
  })

  it('keep a line that is not JSON as it came', () => {
    expect(entries().system('not json')).toEqual({ ...outer, id: 'system:run1:1', kind: 'system', at: 1000, body: 'not json' })
  })
})

describe('client entries', () => {
  it('count within the run and say what happened in the kind', () => {
    const made = entries()

    expect(made.client('connected', { connection: 1 })).toEqual({
      ...outer,
      id: 'client:run1:1',
      kind: 'client.connected',
      at: 1000,
      body: { connection: 1 },
    })
    expect(made.client('connected', { connection: 2 }).id).toBe('client:run1:2')
  })
})

describe('PHD2 entries', () => {
  it('name the event in the kind and take their time from PHD2', () => {
    const event = { Event: 'GuideStep', Timestamp: 1793990281.025, dx: -1.283 }

    expect(entries().phd2(JSON.stringify(event))).toEqual({
      ...outer,
      id: 'phd2:run1:1',
      kind: 'phd2.GuideStep',
      at: 1793990281025,
      body: event,
    })
  })

  it('keep a line it cannot read as it came', () => {
    expect(entries().phd2('not json')).toEqual({ ...outer, id: 'phd2:run1:1', kind: 'phd2.unknown', at: 1000, body: 'not json' })
  })
})
