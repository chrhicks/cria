import { describe, expect, it } from 'vitest'
import type { TappedMessage, WireFacts } from '../indi/index.ts'
import { makeEntries, readWireBody } from './entry.ts'

function entries() {
  return makeEntries({ rig: 'test-rig', source: 'test:stream-client', run: 'run1', now: () => 1000 })
}

const outer = { v: 2, rig: 'test-rig', run: 'run1', source: 'test:stream-client' }

describe('wire entries', () => {
  const tapped = (dir: 'in' | 'out', xml: string, facts: WireFacts): TappedMessage => ({ dir, xml, facts })
  const set = tapped('in', '<setSwitchVector device="ZWO AM5" name="TELESCOPE_TRACK_STATE" state="Ok"><oneSwitch name="TRACK_ON">On</oneSwitch></setSwitchVector>', {
    type: 'set',
    indiDevice: 'ZWO AM5',
    property: 'TELESCOPE_TRACK_STATE',
    state: 'Ok',
    elements: { TRACK_ON: true },
  })

  it('keep the raw XML and carry what the parser read, and count each direction of each connection', () => {
    const made = entries()

    expect(made.wire(set, 'mount')).toEqual({
      ...outer,
      id: 'wire:run1:in:1',
      kind: 'wire',
      at: 1000,
      body: { dir: 'in', n: 1, xml: set.xml, device: 'mount', type: 'set', indiDevice: 'ZWO AM5', property: 'TELESCOPE_TRACK_STATE', state: 'Ok', elements: { TRACK_ON: true } },
    })
    expect(made.wire(set, 'mount').id).toBe('wire:run1:in:2')
    expect(made.wire({ ...set, dir: 'out' }, 'mount').id).toBe('wire:run1:out:1')
  })

  it('read back as a wire body, and a body from before the parse is not one', () => {
    const body = entries().wire(set, 'mount').body

    expect(readWireBody(body)?.property).toBe('TELESCOPE_TRACK_STATE')
    expect(readWireBody({ dir: 'in', n: 1, xml: '<a/>' })).toBeUndefined()
    expect(readWireBody('text')).toBeUndefined()
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

describe('protocol problem entries', () => {
  it('carry what the parser could not read, under the INDI names the wire entries use', () => {
    const problem = { scope: 'element' as const, reason: 'INDI element has an empty name', tag: 'defSwitchVector', device: 'ZWO AM5', name: 'ALTITUDE_LIMIT_CONTROL', utf8: true, excerpt: '<defSwitchVector/>', bytes: 18 }

    expect(entries().protocolProblem({ consequence: 'skipped the element', problem })).toEqual({
      ...outer,
      id: 'client:run1:1',
      kind: 'client.protocol-problem',
      at: 1000,
      body: { target: 'indiserver', consequence: 'skipped the element', scope: 'element', reason: 'INDI element has an empty name', tag: 'defSwitchVector', utf8: true, excerpt: '<defSwitchVector/>', bytes: 18, indiDevice: 'ZWO AM5', property: 'ALTITUDE_LIMIT_CONTROL' },
    })
  })

  it('leave out the device and property when the problem names none', () => {
    const { body } = entries().protocolProblem({ consequence: 'lost the framing and skipped to the next element', problem: { scope: 'framing', reason: 'Text outside any INDI element', tag: '', utf8: true, excerpt: 'xx', bytes: 2 } })

    expect(body).not.toHaveProperty('indiDevice')
    expect(body).not.toHaveProperty('property')
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
    expect(entries().phd2('{"jsonrpc":"2.0","result":0,"id":"vela-1"}')).toMatchObject({ kind: 'phd2.reply', body: { result: 0, id: 'vela-1' } })
    expect(entries().phd2('not json')).toEqual({ ...outer, id: 'phd2:run1:1', kind: 'phd2.unknown', at: 1000, body: 'not json' })
  })
})
