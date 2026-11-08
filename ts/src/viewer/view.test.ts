import { describe, expect, it } from 'vitest'
import type { WireFacts } from '../indi/index.ts'
import { readEntry } from './history.ts'
import { viewOf } from './view.ts'

function entry(kind: string, body: unknown, extra: Record<string, unknown> = {}) {
  return readEntry(JSON.stringify({ v: 2, id: 'x', rig: 'r', kind, at: 1, source: 'errai:rig', body, ...extra }))!
}

function wire(facts: WireFacts, dir: 'in' | 'out' = 'in') {
  return entry('wire', { dir, n: 1, xml: '<raw/>', device: 'mount', ...facts })
}

const mountWire = 'rig-dev.wire.mount.in'

describe('the row for an entry', () => {
  it('shows a value the driver set, numbers shortened and switches that are on', () => {
    const view = viewOf(wire({ type: 'set', indiDevice: 'ZWO AM5', property: 'EQUATORIAL_EOD_COORD', state: 'Busy', elements: { RA: 1.23456789, DEC: -2, ON: true, OFF: false } }), mountWire, undefined)

    expect(view).toEqual({
      source: 'mount',
      who: 'mount',
      label: 'in',
      what: 'EQUATORIAL_EOD_COORD',
      state: 'Busy',
      pairs: [['RA', '1.234568'], ['DEC', '-2'], ['ON', 'On']],
      text: '',
      quiet: false,
    })
  })

  it('shows the whole property when it knows more than the update carried', () => {
    const view = viewOf(wire({ type: 'set', indiDevice: 'ZWO AM5', property: 'COORD', elements: { RA: 5 } }), mountWire, { state: 'Ok', elements: { RA: 5, DEC: 2 } })

    expect(view.state).toBe('Ok')
    expect(view.pairs).toEqual([['RA', '5'], ['DEC', '2']])
  })

  it('marks a command, and keeps definitions, deletions and debug messages quiet', () => {
    expect(viewOf(wire({ type: 'new', property: 'TELESCOPE_ABORT_MOTION' }, 'out'), mountWire, undefined)).toMatchObject({ label: 'cmd', what: 'TELESCOPE_ABORT_MOTION', quiet: false })
    expect(viewOf(wire({ type: 'def', property: 'CONNECTION' }), mountWire, undefined)).toMatchObject({ text: 'defined', quiet: true })
    expect(viewOf(wire({ type: 'del', property: 'CONNECTION' }), mountWire, undefined)).toMatchObject({ text: 'deleted', quiet: true })
    expect(viewOf(wire({ type: 'message', text: '[DEBUG] tick' }), mountWire, undefined)).toMatchObject({ what: 'message', text: '[DEBUG] tick', quiet: true })
    expect(viewOf(wire({ type: 'message', text: '[ERROR] gone' }), mountWire, undefined).quiet).toBe(false)
    expect(viewOf(wire({ type: 'other', tag: 'getProperties' }), mountWire, undefined)).toMatchObject({ what: 'getProperties', quiet: true })
  })

  it('shows a version 1 wire entry as its raw XML under the device in its subject', () => {
    const old = readEntry(JSON.stringify({ v: 1, kind: 'wire', at: 1, body: { dir: 'in', n: 1, xml: '  <setNumberVector/>\n' } }))!

    expect(viewOf(old, 'rig-dev.wire.guide-cam.in', undefined)).toEqual({ source: 'guide-cam', who: 'guide-cam', label: 'in', what: '', state: '', pairs: [], text: '<setNumberVector/>', quiet: true })
  })

  it('shows a journal line by who wrote it and its unit, and quiets debug priority', () => {
    const line = entry('system', { SYSLOG_IDENTIFIER: 'kernel', _SYSTEMD_UNIT: 'usb.service', MESSAGE: 'usb 1-1: reset', PRIORITY: '6' })

    expect(viewOf(line, 'rig-dev.system', undefined)).toMatchObject({ source: 'system', who: 'kernel', what: 'usb.service', text: 'usb 1-1: reset', quiet: false })
    expect(viewOf(entry('system', { MESSAGE: 'x', PRIORITY: '7' }), 'rig-dev.system', undefined)).toMatchObject({ who: 'journal', quiet: true })
    expect(viewOf(entry('system', 'not json'), 'rig-dev.system', undefined)).toMatchObject({ who: 'journal', text: 'not json' })
  })

  it('shows a PHD2 event with its fields, less the ones every event has', () => {
    const view = viewOf(entry('phd2.GuideStep', { Event: 'GuideStep', Timestamp: 1, Host: 'h', Inst: 1, RADistanceRaw: 0.25, Limit: false, Enabled: true }), 'rig-dev.phd2', undefined)

    expect(view).toMatchObject({ source: 'phd2', what: 'GuideStep', pairs: [['RADistanceRaw', '0.25'], ['Limit', 'false'], ['Enabled', 'true']] })
  })

  it('shows client entries by the program that wrote them', () => {
    expect(viewOf(entry('client.connection', { target: 'phd2', status: 'closed', error: 'refused' }), 'rig-dev.client', undefined)).toMatchObject({
      source: 'client',
      who: 'rig',
      what: 'connection phd2',
      state: 'closed',
      text: 'refused',
    })
    expect(viewOf(entry('client.connected', { connection: 1, sources: ['wire', 'phd2'] }), 'rig-dev.client', undefined)).toMatchObject({
      what: 'connected',
      pairs: [['connection', '1'], ['sources', 'wire, phd2']],
    })
  })

  it('shows a protocol problem with where it was and what was lost', () => {
    const problem = entry('client.protocol-problem', { target: 'indiserver', consequence: 'skipped', scope: 'element', reason: 'bad number', tag: 'oneNumber', indiDevice: 'ZWO AM5', bytes: 40, excerpt: '<oneNumber' })

    expect(viewOf(problem, 'rig-dev.client', undefined)).toMatchObject({
      what: 'protocol problem',
      state: 'element',
      pairs: [['tag', 'oneNumber'], ['device', 'ZWO AM5'], ['bytes', '40']],
      text: 'skipped: bad number: <oneNumber',
    })
  })

  it('shows a client entry with missing fields instead of failing', () => {
    expect(viewOf(entry('client.connected', 'odd'), 'rig-dev.client', undefined)).toMatchObject({ what: 'connected', pairs: [['connection', ''], ['sources', '']] })
  })
})
