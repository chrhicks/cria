import { describe, expect, it } from 'vitest'
import type { WireFacts } from '../indi/index.ts'
import { classify, makeHistory, parseQuery, readEntry, type Raw } from './history.ts'

function entry(kind: string, body: unknown, at = 1, v = 2) {
  return JSON.stringify({ v, id: 'x', rig: 'r', kind, at, source: 's', body })
}

function wire(facts: WireFacts, device = 'mount', at = 1) {
  return entry('wire', { conn: 1, dir: 'in', n: 1, xml: '<raw/>', device, ...facts }, at)
}

const mountWire = 'rig-dev.wire.mount.in'

function raw(seq: number, subject: string, text: string): Raw {
  return { seq, subject, text }
}

function classified(subject: string, text: string) {
  return classify(subject, readEntry(text)!)
}

const reading = (ra: number, state: 'Ok' | 'Alert' = 'Ok'): WireFacts => ({ type: 'set', indiDevice: 'ZWO AM5', property: 'COORD', state, elements: { RA: ra } })

describe('classify', () => {
  it('names the device from the entry, whatever characters its id has', () => {
    expect(classified(mountWire, wire({ type: 'set', indiDevice: 'ZWO AM5', state: 'Ok' }))).toMatchObject({ source: 'mount', command: false, problem: false, group: undefined })
    expect(classified('rig-dev.wire.guide-cam.in', wire({ type: 'set', indiDevice: 'ZWO ASI120', property: 'CCD_TEMPERATURE', state: 'Ok' }, 'guide-cam'))).toMatchObject({
      source: 'guide-cam',
      group: 'ZWO ASI120.CCD_TEMPERATURE',
    })
  })

  it('finds an Alert only on a value the driver set', () => {
    expect(classified(mountWire, wire({ type: 'set', state: 'Alert' }))?.problem).toBe(true)
    expect(classified(mountWire, wire({ type: 'def', state: 'Alert' }))?.problem).toBe(false)
  })

  it('finds an error message', () => {
    expect(classified(mountWire, wire({ type: 'message', text: '[ERROR] Serial write error' }))?.problem).toBe(true)
    expect(classified(mountWire, wire({ type: 'message', text: '[WARNING] missing' }))?.problem).toBe(false)
  })

  it('finds a command another program sent', () => {
    expect(classified(mountWire, wire({ type: 'new', property: 'CCD_EXPOSURE' }))?.command).toBe(true)
  })

  it('reads journal priority and PHD2 events', () => {
    expect(classified('rig-dev.system', entry('system', { PRIORITY: '3' }))).toEqual({ source: 'system', command: false, problem: true, group: undefined, wire: undefined })
    expect(classified('rig-dev.system', entry('system', { PRIORITY: '6' }))?.problem).toBe(false)
    expect(classified('rig-dev.phd2', entry('phd2.StarLost', {}))).toEqual({ source: 'phd2', command: false, problem: true, group: 'phd2.StarLost', wire: undefined })
    expect(classified('rig-dev.phd2', entry('phd2.GuideStep', {}))?.problem).toBe(false)
  })

  it('names a client entry as its own source', () => {
    expect(classified('rig-dev.client', entry('client.connected', {}))).toEqual({ source: 'client', command: false, problem: false, group: 'client.connected', wire: undefined })
  })

  it('counts a protocol problem the parser reported as a problem', () => {
    expect(classified('rig-dev.client', entry('client.protocol-problem', { target: 'indiserver', scope: 'framing' }))).toEqual({ source: 'client', command: false, problem: true, group: 'client.protocol-problem.indiserver', wire: undefined })
  })

  it('groups a client connection by what it connected to', () => {
    expect(classified('rig-dev.client', entry('client.connection', { target: 'phd2', status: 'closed' }))?.group).toBe('client.connection.phd2')
  })

  it('reads a version 1 wire entry as raw XML under the device in its subject, hyphens included', () => {
    const old = entry('wire', { conn: 1, dir: 'in', n: 1, xml: '<setNumberVector state="Alert"/>' }, 1, 1)

    expect(classified('rig-dev.wire.guide-cam.in', old)).toEqual({ source: 'guide-cam', command: false, problem: false, group: undefined, wire: undefined })
  })

  it('skips a wire entry without a device anywhere', () => {
    expect(classified('rig-dev.wire.in', entry('wire', { conn: 1, dir: 'in', n: 1, xml: '<a/>' }, 1, 1))).toBeUndefined()
  })

  it('skips text that is not an entry', () => {
    expect(readEntry('<setNumberVector/>')).toBeUndefined()
    expect(readEntry(entry('wire', {}, 1, 3))).toBeUndefined()
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
  const quiet = wire({ type: 'set', state: 'Ok' })

  it('keeps the newest entries that match and counts every source', () => {
    const history = makeHistory(parseQuery(new URLSearchParams('show=mount')), 2)

    history.take(raw(1, mountWire, quiet))
    history.take(raw(2, 'rig-dev.wire.box.in', wire({ type: 'set', state: 'Ok' }, 'box')))
    history.take(raw(3, mountWire, quiet))
    history.take(raw(4, mountWire, quiet))

    expect(history.drained().map(kept => kept.seq)).toEqual([3, 4])
    expect(history.counted()).toEqual({ counts: { mount: 3, box: 1, changes: 4 }, scanned: 4, matched: 3 })
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

    expect(history.take(raw(1, mountWire, quiet))).toBeUndefined()
    expect(history.take(raw(2, mountWire, wire({ type: 'new' })))).toBeUndefined()
    expect(history.take(raw(3, mountWire, wire({ type: 'set', state: 'Alert' })))?.problem).toBe(true)
    expect(history.counted().counts).toEqual({ mount: 3, commands: 1, problems: 1, changes: 3 })
  })

  describe('the window', () => {
    it('is the entry\'s own time, and a delivered entry shows the same time', () => {
      const history = makeHistory(parseQuery(new URLSearchParams('since=100&until=200')), 10)

      expect(history.take(raw(1, mountWire, wire({ type: 'set' }, 'mount', 99)))).toBeUndefined()
      expect(history.take(raw(2, mountWire, wire({ type: 'set' }, 'mount', 150)))?.at).toBe(150)
      expect(history.take(raw(3, mountWire, wire({ type: 'set' }, 'mount', 201)))).toBeUndefined()
      expect(history.counted().scanned).toBe(1)
    })
  })

  describe('changes only', () => {
    function changes() {
      return makeHistory(parseQuery(new URLSearchParams('changes=')), 10)
    }

    it('keeps the first reading of a property, then only a different one', () => {
      const history = changes()

      expect(history.take(raw(1, mountWire, wire(reading(1))))).toBeDefined()
      expect(history.take(raw(2, mountWire, wire(reading(1))))).toBeUndefined()
      expect(history.take(raw(3, mountWire, wire(reading(2))))).toBeDefined()
    })

    it('counts a change of state as a change', () => {
      const history = changes()

      history.take(raw(1, mountWire, wire(reading(1))))

      expect(history.take(raw(2, mountWire, wire(reading(1, 'Alert'))))).toBeDefined()
    })

    it('does not call a partial update that repeats what it carries a change', () => {
      const history = changes()
      const both = wire({ type: 'set', indiDevice: 'ZWO AM5', property: 'COORD', state: 'Ok', elements: { RA: 1, DEC: 2 } })
      const onlyRa = wire({ type: 'set', indiDevice: 'ZWO AM5', property: 'COORD', elements: { RA: 1 } })
      const newRa = wire({ type: 'set', indiDevice: 'ZWO AM5', property: 'COORD', elements: { RA: 3 } })

      history.take(raw(1, mountWire, both))

      expect(history.take(raw(2, mountWire, onlyRa))).toBeUndefined()
      expect(history.take(raw(3, mountWire, newRa))).toBeDefined()
    })

    it('tracks each property on each device apart', () => {
      const history = changes()

      history.take(raw(1, mountWire, wire(reading(1))))

      expect(history.take(raw(2, 'rig-dev.wire.box.in', wire({ ...reading(1), indiDevice: 'Pegasus PPBA' }, 'box')))).toBeDefined()
    })

    it('always keeps entries that are not readings', () => {
      const history = changes()
      const message = wire({ type: 'message', indiDevice: 'ZWO AM5', text: 'hello' })
      const journal = entry('system', { PRIORITY: '6' })

      expect(history.take(raw(1, mountWire, message))).toBeDefined()
      expect(history.take(raw(2, mountWire, message))).toBeDefined()
      expect(history.take(raw(3, 'rig-dev.system', journal))).toBeDefined()
      expect(history.take(raw(4, 'rig-dev.system', journal))).toBeDefined()
    })

    it('reads a definition and a later value as the same reading', () => {
      const history = changes()

      history.take(raw(1, mountWire, wire({ ...reading(1), type: 'def' })))

      expect(history.take(raw(2, mountWire, wire(reading(1))))).toBeUndefined()
    })

    it('keeps a deletion and the definition that follows it', () => {
      const history = changes()

      history.take(raw(1, mountWire, wire(reading(1))))

      expect(history.take(raw(2, mountWire, wire({ type: 'del', indiDevice: 'ZWO AM5', property: 'COORD' })))).toBeDefined()
      expect(history.take(raw(3, mountWire, wire({ ...reading(1), type: 'def' })))).toBeDefined()
    })

    it('starts over when a new INDI connection or a new rig program run begins', () => {
      const history = changes()

      history.take(raw(1, mountWire, wire(reading(1))))
      expect(history.take(raw(2, mountWire, wire(reading(1))))).toBeUndefined()

      history.take(raw(3, 'rig-dev.client', entry('client.connection', { target: 'indiserver', status: 'connected' })))
      expect(history.take(raw(4, mountWire, wire(reading(1))))).toBeDefined()
      expect(history.take(raw(5, mountWire, wire(reading(1))))).toBeUndefined()

      history.take(raw(6, 'rig-dev.client', entry('client.connected', { run: 'a' })))
      history.take(raw(7, mountWire, wire(reading(1))))
      history.take(raw(8, 'rig-dev.client', entry('client.connected', { run: 'a' })))
      expect(history.take(raw(9, mountWire, wire(reading(1))))).toBeUndefined()

      history.take(raw(10, 'rig-dev.client', entry('client.connected', { run: 'b' })))
      expect(history.take(raw(11, mountWire, wire(reading(1))))).toBeDefined()
    })
  })

  describe('each property\'s latest reading', () => {
    const table = () => makeHistory(parseQuery(new URLSearchParams('table=')), 10)

    it('holds the latest reading, how many, and when it last changed', () => {
      const history = table()

      history.take(raw(1, mountWire, wire(reading(1), 'mount', 11)))
      history.take(raw(2, mountWire, wire(reading(2), 'mount', 12)))
      history.take(raw(3, mountWire, wire(reading(2), 'mount', 13)))

      const [group] = history.groups()

      expect(group?.group).toBe('ZWO AM5.COORD')
      expect(group?.latest.seq).toBe(3)
      expect(group?.reads).toBe(3)
      expect(group?.changes).toBe(1)
      expect(group?.changedAt).toBe(12)
    })

    it('holds every element of the property, not only those the last update carried', () => {
      const history = table()

      history.take(raw(1, mountWire, wire({ type: 'def', indiDevice: 'ZWO AM5', property: 'COORD', state: 'Ok', elements: { RA: 1, DEC: 2 } })))
      history.take(raw(2, mountWire, wire({ type: 'set', indiDevice: 'ZWO AM5', property: 'COORD', elements: { RA: 5 } })))

      expect(history.groups()[0]?.current).toEqual({ state: 'Ok', elements: { RA: 5, DEC: 2 } })
    })

    it('does not call the first reading in a window a change', () => {
      const history = table()

      history.take(raw(1, mountWire, wire(reading(1))))

      expect(history.groups()[0]?.changes).toBe(0)
      expect(history.groups()[0]?.changedAt).toBeUndefined()
    })

    it('delivers every entry, whatever the other filters', () => {
      const history = makeHistory(parseQuery(new URLSearchParams('table=&changes=&show=box')), 10)

      history.take(raw(1, mountWire, wire(reading(1))))

      expect(history.take(raw(2, mountWire, wire(reading(1))))?.differs).toBe(false)
      expect(history.take(raw(3, mountWire, wire(reading(2))))?.differs).toBe(true)
    })

    it('groups PHD2 by event and leaves the journal out', () => {
      const history = table()

      history.take(raw(1, 'rig-dev.phd2', entry('phd2.GuideStep', {})))
      history.take(raw(2, 'rig-dev.phd2', entry('phd2.GuideStep', {})))
      history.take(raw(3, 'rig-dev.system', entry('system', { PRIORITY: '6' })))

      expect(history.groups().map(group => [group.group, group.reads])).toEqual([['phd2.GuideStep', 2]])
    })
  })
})
