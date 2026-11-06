import { describe, expect, it } from 'vitest'
import { classify, makeHistory, parseQuery, type Raw } from './viewer-history.js'

function entry(kind: string, body: unknown) {
  return JSON.stringify({ v: 1, id: 'x', rig: 'r', kind, at: 1, source: 's', tags: [], body })
}

function wire(xml: string) {
  return entry('wire', { conn: 1, dir: 'in', n: 1, xml })
}

const mountWire = 'rig-dev.wire.mount.in'

function raw(seq: number, subject: string, text: string): Raw {
  return { seq, at: seq, subject, text }
}

describe('classify', () => {
  it('names the device from the subject', () => {
    expect(classify(mountWire, wire('<setNumberVector device="ZWO AM5" state="Ok"></setNumberVector>'))).toEqual({
      source: 'mount',
      command: false,
      problem: false,
    })
  })

  it('finds an Alert only on a value the driver set', () => {
    expect(classify(mountWire, wire('<setNumberVector state="Alert"></setNumberVector>'))?.problem).toBe(true)
    expect(classify(mountWire, wire('<defNumberVector state="Alert"></defNumberVector>'))?.problem).toBe(false)
  })

  it('finds an error message', () => {
    expect(classify(mountWire, wire('<message message="[ERROR] Serial write error"/>'))?.problem).toBe(true)
    expect(classify(mountWire, wire('<message message="[WARNING] missing"/>'))?.problem).toBe(false)
  })

  it('finds a command another program sent', () => {
    expect(classify(mountWire, wire('<newNumberVector name="CCD_EXPOSURE"></newNumberVector>'))?.command).toBe(true)
  })

  it('reads journal priority and PHD2 events', () => {
    expect(classify('rig-dev.system', entry('system', { PRIORITY: '3' }))).toEqual({ source: 'system', command: false, problem: true })
    expect(classify('rig-dev.system', entry('system', { PRIORITY: '6' }))?.problem).toBe(false)
    expect(classify('rig-dev.phd2', entry('phd2.StarLost', {}))).toEqual({ source: 'phd2', command: false, problem: true })
    expect(classify('rig-dev.phd2', entry('phd2.GuideStep', {}))?.problem).toBe(false)
  })

  it('skips raw entries from before the entry format', () => {
    expect(classify('rig-dev.wire.in', '<setNumberVector/>')).toBeUndefined()
  })
})

describe('parseQuery', () => {
  it('reads the window and filters', () => {
    const query = parseQuery(new URLSearchParams('since=100&until=200&show=mount,box&problems='))

    expect(query.since).toBe(100)
    expect(query.until).toBe(200)
    expect([...query.show]).toEqual(['mount', 'box'])
    expect(query.problems).toBe(true)
    expect(query.commands).toBe(false)
  })

  it('leaves out a time it cannot read', () => {
    expect(parseQuery(new URLSearchParams('since=soon')).since).toBeUndefined()
    expect(parseQuery(new URLSearchParams('')).since).toBeUndefined()
  })
})

describe('history', () => {
  const quiet = wire('<setNumberVector state="Ok"></setNumberVector>')

  it('keeps the newest entries that match and counts every source', () => {
    const history = makeHistory(parseQuery(new URLSearchParams('show=mount')), 2)

    history.take(raw(1, mountWire, quiet))
    history.take(raw(2, 'rig-dev.wire.box.in', quiet))
    history.take(raw(3, mountWire, quiet))
    history.take(raw(4, mountWire, quiet))

    expect(history.drained().map(kept => kept.seq)).toEqual([3, 4])
    expect(history.counted()).toEqual({ counts: { mount: 3, box: 1 }, scanned: 4, matched: 3 })
  })

  it('reports counts once, so a reader can add them up', () => {
    const history = makeHistory(parseQuery(new URLSearchParams('')), 2)

    history.take(raw(1, mountWire, quiet))
    history.counted()
    history.take(raw(2, mountWire, quiet))

    expect(history.counted().scanned).toBe(1)
  })

  it('narrows to problems and commands, and counts them either way', () => {
    const history = makeHistory(parseQuery(new URLSearchParams('problems=')), 5)
    const alert = wire('<setNumberVector state="Alert"></setNumberVector>')
    const command = wire('<newNumberVector></newNumberVector>')

    expect(history.take(raw(1, mountWire, quiet))).toBeUndefined()
    expect(history.take(raw(2, mountWire, command))).toBeUndefined()
    expect(history.take(raw(3, mountWire, alert))?.problem).toBe(true)
    expect(history.counted().counts).toEqual({ mount: 3, commands: 1, problems: 1 })
  })
})
