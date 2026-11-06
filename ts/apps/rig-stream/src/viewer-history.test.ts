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
      property: undefined,
      reading: undefined,
      group: undefined,
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
    expect(classify('rig-dev.system', entry('system', { PRIORITY: '3' }))).toEqual({ source: 'system', command: false, problem: true, property: undefined, reading: undefined, group: undefined })
    expect(classify('rig-dev.system', entry('system', { PRIORITY: '6' }))?.problem).toBe(false)
    expect(classify('rig-dev.phd2', entry('phd2.StarLost', {}))).toEqual({ source: 'phd2', command: false, problem: true, property: undefined, reading: undefined, group: 'phd2.StarLost' })
    expect(classify('rig-dev.phd2', entry('phd2.GuideStep', {}))?.problem).toBe(false)
  })

  it('names a client entry as its own source', () => {
    expect(classify('rig-dev.client', entry('client.connected', {}))).toEqual({
      source: 'client',
      command: false,
      problem: false,
      property: undefined,
      reading: undefined,
      group: 'client.connected',
    })
  })

  it('groups a client connection by what it connected to', () => {
    expect(classify('rig-dev.client', entry('client.connection', { target: 'phd2', status: 'closed' }))?.group).toBe('client.connection.phd2')
  })

  it('counts what Cria was asked as a command, and a refusal or bad ending as a problem', () => {
    const request = (result: string) => classify('rig-dev.cria.request', entry('cria.request', { deviceId: 'primary', kind: 'capture', result }))

    expect(request('accepted')).toMatchObject({ source: 'cria', command: true, problem: false, group: 'cria.request.primary.capture' })
    expect(request('refused')?.problem).toBe(true)

    const settled = (kind: string) => classify('rig-dev.cria.settled', entry('cria.settled', { deviceId: 'mount', kind: 'mount-stop', outcome: { kind } }))

    expect(settled('confirmed')).toMatchObject({ command: false, problem: false, group: 'cria.settled.mount.mount-stop' })
    expect(settled('failed')?.problem).toBe(true)
    expect(settled('uncertain')?.problem).toBe(true)
  })

  it('groups what Cria wrote by device and property', () => {
    expect(classify('rig-dev.cria.write', entry('cria.write', { device: 'mount', property: 'TIME_UTC', xml: '<newTextVector/>' }))).toMatchObject({
      source: 'cria',
      command: false,
      problem: false,
      group: 'cria.write.mount.TIME_UTC',
    })
  })

  it('skips a wire entry without a device in its subject', () => {
    expect(classify('rig-dev.wire.in', wire('<setNumberVector state="Ok"></setNumberVector>'))).toBeUndefined()
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
    const alert = wire('<setNumberVector state="Alert"></setNumberVector>')
    const command = wire('<newNumberVector></newNumberVector>')

    expect(history.take(raw(1, mountWire, quiet))).toBeUndefined()
    expect(history.take(raw(2, mountWire, command))).toBeUndefined()
    expect(history.take(raw(3, mountWire, alert))?.problem).toBe(true)
    expect(history.counted().counts).toEqual({ mount: 3, commands: 1, problems: 1, changes: 3 })
  })

  describe('changes only', () => {
    const value = (ra: string, state = 'Ok', timestamp = '2026-11-06T19:00:00') =>
      wire(`<setNumberVector device="ZWO AM5" name="COORD" state="${state}" timestamp="${timestamp}">\n  <oneNumber name="RA">\n ${ra}\n</oneNumber>\n</setNumberVector>`)

    function changes() {
      return makeHistory(parseQuery(new URLSearchParams('changes=')), 10)
    }

    it('keeps the first reading of a property, then only a different one', () => {
      const history = changes()

      expect(history.take(raw(1, mountWire, value('1')))).toBeDefined()
      expect(history.take(raw(2, mountWire, value('1', 'Ok', '2026-11-06T19:00:01')))).toBeUndefined()
      expect(history.take(raw(3, mountWire, value('2')))).toBeDefined()
    })

    it('counts a change of state as a change', () => {
      const history = changes()

      history.take(raw(1, mountWire, value('1')))

      expect(history.take(raw(2, mountWire, value('1', 'Alert')))).toBeDefined()
    })

    it('tracks each property on each device apart', () => {
      const history = changes()

      history.take(raw(1, mountWire, value('1')))

      expect(history.take(raw(2, 'rig-dev.wire.box.in', value('1')))).toBeDefined()
    })

    it('always keeps entries that are not readings', () => {
      const history = changes()
      const message = wire('<message device="ZWO AM5" message="hello"/>')
      const journal = entry('system', { PRIORITY: '6' })

      expect(history.take(raw(1, mountWire, message))).toBeDefined()
      expect(history.take(raw(2, mountWire, message))).toBeDefined()
      expect(history.take(raw(3, 'rig-dev.system', journal))).toBeDefined()
      expect(history.take(raw(4, 'rig-dev.system', journal))).toBeDefined()
    })

    it('reads a definition and a later value as the same reading', () => {
      const history = changes()
      const defined = wire('<defNumberVector device="ZWO AM5" name="COORD" state="Ok"><defNumber name="RA" format="%f">1</defNumber></defNumberVector>')

      history.take(raw(1, mountWire, defined))

      expect(history.take(raw(2, mountWire, value('1')))).toBeUndefined()
    })
  })

  describe('each property\'s latest reading', () => {
    const value = (ra: string) => wire(`<setNumberVector device="ZWO AM5" name="COORD" state="Ok"><oneNumber name="RA">${ra}</oneNumber></setNumberVector>`)
    const table = () => makeHistory(parseQuery(new URLSearchParams('table=')), 10)

    it('holds the latest reading, how many, and when it last changed', () => {
      const history = table()

      history.take(raw(1, mountWire, value('1')))
      history.take(raw(2, mountWire, value('2')))
      history.take(raw(3, mountWire, value('2')))

      const [group] = history.groups()

      expect(group?.group).toBe('mount.COORD')
      expect(group?.latest.seq).toBe(3)
      expect(group?.reads).toBe(3)
      expect(group?.changes).toBe(1)
      expect(group?.changedAt).toBe(2)
    })

    it('does not call the first reading in a window a change', () => {
      const history = table()

      history.take(raw(1, mountWire, value('1')))

      expect(history.groups()[0]?.changes).toBe(0)
      expect(history.groups()[0]?.changedAt).toBeUndefined()
    })

    it('delivers every entry, whatever the other filters', () => {
      const history = makeHistory(parseQuery(new URLSearchParams('table=&changes=&show=box')), 10)

      history.take(raw(1, mountWire, value('1')))

      expect(history.take(raw(2, mountWire, value('1')))?.differs).toBe(false)
      expect(history.take(raw(3, mountWire, value('2')))?.differs).toBe(true)
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
