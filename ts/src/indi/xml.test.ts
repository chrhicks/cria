import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { factsOfRequest, IndiFramer, parseNumber, serialize, type IndiMessage } from './xml.ts'
import { Mirror } from './mirror.ts'

// Real traffic from indiserver 2.2.5 with the CCD, telescope, focuser and
// weather simulators: definitions, a 64x48 exposure, a focuser
// move and a weather disconnect (which deletes properties).
const recorded = readFileSync(new URL('./fixtures/simulators.xml', import.meta.url))

const messagesIn = (framer: IndiFramer, chunk: Buffer) => framer.frame(chunk, false).elements.flatMap(element => (element.message ? [element.message] : []))

function parseInChunks(bytes: Buffer, sizes: () => number): IndiMessage[] {
  const framer = new IndiFramer()
  const messages: IndiMessage[] = []

  for (let at = 0; at < bytes.length; ) {
    const size = Math.max(1, sizes())

    messages.push(...messagesIn(framer, bytes.subarray(at, at + size)))
    at += size
  }

  return messages
}

/** Deterministic pseudo-random chunk sizes, including single bytes. */
function chunkSizes(seed: number) {
  let state = seed

  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31

    return state % 7 === 0 ? 1 : state % 5000
  }
}

describe('INDI XML framing', () => {
  const whole = parseInChunks(recorded, () => recorded.length)

  it('reads every top-level element of real indiserver traffic', () => {
    const definitions = recorded.toString('latin1').match(/<def\w+Vector/g)!.length

    expect(whole.filter(message => message.type === 'def')).toHaveLength(definitions)
    expect(whole.some(message => message.type === 'del')).toBe(true)
  })

  it('gives the same messages however the bytes are split', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const split = parseInChunks(recorded, chunkSizes(seed))

      expect(split).toEqual(whole)
    }
  })

  it('builds a mirror that knows the current values and deletes what the driver removed', () => {
    const mirror = new Mirror()

    for (const message of whole) mirror.apply(message)

    expect(mirror.property('Focuser Simulator', 'ABS_FOCUS_POSITION')?.elements.get('FOCUS_ABSOLUTE_POSITION')).toMatchObject({ value: 50200 })
    expect(mirror.property('Telescope Simulator', 'TELESCOPE_TRACK_MODE')?.elements.get('TRACK_SIDEREAL')).toMatchObject({ on: true })
    expect(mirror.property('Weather Simulator', 'WEATHER_PARAMETERS')).toBeUndefined()
    expect(mirror.property('CCD Simulator', 'CCD_EXPOSURE')?.state).toBe('Ok')
  })
})

describe('INDI values', () => {
  it('parses decimal and sexagesimal numbers', () => {
    expect(parseNumber(' 12.5 ')).toBe(12.5)
    expect(parseNumber('-12:30:00')).toBe(-12.5)
    expect(parseNumber('05 30')).toBe(5.5)
    expect(() => parseNumber('nan')).toThrow()
  })

  it('trims the whitespace indiserver puts around text values (errai, libindi 2.2.5)', () => {
    const framer = new IndiFramer()
    const [definition, update] = messagesIn(framer, 
      Buffer.from(
        '<defTextVector device="ZWO CCD ASI2600MC Pro" name="CCD_CFA" state="Idle" perm="rw">\n' +
          '    <defText name="CFA_TYPE" label="Filter">\nRGGB\n    </defText>\n</defTextVector>\n' +
          '<setTextVector device="ZWO CCD ASI2600MC Pro" name="CCD_CFA" state="Idle">\n' +
          '    <oneText name="CFA_TYPE">\nRGGB\n    </oneText>\n</setTextVector>\n',
      ),
    )

    expect(definition?.type === 'def' && definition.vector.elements[0]).toMatchObject({ value: 'RGGB' })
    expect(update?.type === 'set' && update.vector.elements[0]).toMatchObject({ value: 'RGGB' })
  })

  it('decodes entities in text and attributes', () => {
    const [message] = messagesIn(new IndiFramer(), 
      Buffer.from('<defTextVector device="A &amp; B" name="N" label="x &lt; 1 &#x263A;"><defText name="T">a &amp; b</defText></defTextVector>'),
    )

    expect(message?.type === 'def' && message.vector).toMatchObject({ device: 'A & B', label: 'x < 1 ☺', elements: [{ value: 'a & b' }] })
  })

  it('answers with escaped requests, switches as On/Off', () => {
    expect(serialize({ type: 'new', kind: 'switch', device: 'Dev "1"', name: 'CONNECTION', values: { CONNECT: true } })).toBe(
      '<newSwitchVector device="Dev &quot;1&quot;" name="CONNECTION">\n  <oneSwitch name="CONNECT">On</oneSwitch>\n</newSwitchVector>\n',
    )
    expect(() => serialize({ type: 'new', kind: 'number', device: 'D', name: 'N', values: { V: Number.NaN } })).toThrow()
  })
})

describe('INDI framing for the traffic tap', () => {
  it('keeps an element ignored by the parser, with its wire text', () => {
    const relayed = '<newNumberVector device="CCD" name="CCD_CONTROLS"><oneNumber name="Gain">100</oneNumber></newNumberVector>'
    const framed = new IndiFramer().frame(Buffer.from(relayed), true).elements

    expect(framed).toEqual([{ message: undefined, facts: { type: 'new', indiDevice: 'CCD', property: 'CCD_CONTROLS', elements: { Gain: 100 } }, xml: relayed }])
  })

  it('reads a driver message with its device and text', () => {
    const framed = new IndiFramer().frame(Buffer.from('<message device="CCD" message="hello &amp; bye"/><message message="no device"/>'), true).elements

    expect(framed.map(element => element.message)).toEqual([
      { type: 'message', device: 'CCD', text: 'hello & bye' },
      { type: 'message', text: 'no device' },
    ])
  })

  it('frames real indiserver traffic the same however the bytes are split, and keeps the same messages with or without the wire text', () => {
    const whole = new IndiFramer().frame(recorded, true).elements

    expect(whole.map(element => element.message).filter(message => message !== undefined)).toEqual(parseInChunks(recorded, () => recorded.length))

    for (const seed of [3, 11, 99]) {
      const framer = new IndiFramer()
      const sizes = chunkSizes(seed)
      const split = []

      for (let at = 0; at < recorded.length; ) {
        const size = Math.max(1, sizes())

        split.push(...framer.frame(recorded.subarray(at, at + size), true).elements)
        at += size
      }

      expect(split.map(element => element.xml)).toEqual(whole.map(element => element.xml))
    }
  })
})

describe('what an element says, for the recording', () => {
  const factsOf = (xml: string) => new IndiFramer().frame(Buffer.from(xml), true).elements.map(element => element.facts)

  it('reads each kind of element once, from the parse the client uses', () => {
    expect(
      factsOf(
        '<defNumberVector device="Mount" name="COORD" state="Idle" perm="rw" message="ready"><defNumber name="RA" min="0" max="24" step="0.1">5:30</defNumber><defNumber name="DEC" min="-90" max="90" step="1">-10</defNumber></defNumberVector>' +
          '<setSwitchVector device="Mount" name="TRACK" state="Busy"><oneSwitch name="ON">On</oneSwitch><oneSwitch name="OFF">Off</oneSwitch></setSwitchVector>' +
          '<setTextVector device="Cam" name="INFO"><oneText name="MODEL">\nASI\n</oneText></setTextVector>' +
          '<setLightVector device="Cam" name="STATUS" state="Ok"><oneLight name="TEMP">Alert</oneLight></setLightVector>' +
          '<newNumberVector device="Cam" name="GAIN"><oneNumber name="GAIN">100</oneNumber></newNumberVector>' +
          '<delProperty device="Mount" name="COORD"/><delProperty device="Mount"/>' +
          '<message device="Mount" message="[ERROR] bad"/><message message="hello"/>' +
          '<pingRequest uid="7"/>',
      ),
    ).toEqual([
      { type: 'def', indiDevice: 'Mount', property: 'COORD', state: 'Idle', elements: { RA: 5.5, DEC: -10 }, text: 'ready' },
      { type: 'set', indiDevice: 'Mount', property: 'TRACK', state: 'Busy', elements: { ON: true, OFF: false } },
      { type: 'set', indiDevice: 'Cam', property: 'INFO', elements: { MODEL: 'ASI' } },
      { type: 'set', indiDevice: 'Cam', property: 'STATUS', state: 'Ok', elements: { TEMP: 'Alert' } },
      { type: 'new', indiDevice: 'Cam', property: 'GAIN', elements: { GAIN: 100 } },
      { type: 'del', indiDevice: 'Mount', property: 'COORD' },
      { type: 'del', indiDevice: 'Mount' },
      { type: 'message', indiDevice: 'Mount', text: '[ERROR] bad' },
      { type: 'message', text: 'hello' },
      { type: 'other', tag: 'pingRequest' },
    ])
  })

  it('reads a command another client sent as it was written, never as a problem', () => {
    expect(factsOf('<newSwitchVector device="D" name="N"><oneSwitch name="a">On</oneSwitch><oneSwitch name="b">1</oneSwitch></newSwitchVector><newNumberVector device="D" name="M"><oneNumber name="x">soon</oneNumber></newNumberVector>')).toEqual([
      { type: 'new', indiDevice: 'D', property: 'N', elements: { a: true, b: '1' } },
      { type: 'new', indiDevice: 'D', property: 'M', elements: { x: 'soon' } },
    ])
  })

  it('names the property of a BLOB without decoding it', () => {
    expect(factsOf('<setBLOBVector device="Cam" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="3" format=".fits">AAAA</oneBLOB></setBLOBVector>')).toEqual([
      { type: 'set', indiDevice: 'Cam', property: 'CCD1', state: 'Ok' },
    ])
    expect(factsOf('<defBLOBVector device="Cam" name="CCD1" state="Idle" perm="ro"><defBLOB name="CCD1"/></defBLOBVector>')).toEqual([
      { type: 'def', indiDevice: 'Cam', property: 'CCD1', state: 'Idle', elements: {} },
    ])
  })

  it('leaves out the element it could not read and says what went wrong', () => {
    expect(factsOf('<setNumberVector device="Cam" name="T"><oneNumber name="A">1</oneNumber><oneNumber name="">2</oneNumber></setNumberVector>')).toEqual([
      { type: 'set', indiDevice: 'Cam', property: 'T', elements: { A: 1 } },
    ])
    expect(factsOf('<setNumberVector device="Cam" name="T"><oneNumber name="A">x</oneNumber></setNumberVector>')).toEqual([
      { type: 'unreadable', tag: 'setNumberVector', indiDevice: 'Cam', property: 'T', text: 'Invalid INDI number "x"' },
    ])
    expect(factsOf('<mystery/>')).toEqual([{ type: 'unreadable', tag: 'mystery', text: 'Unknown INDI element <mystery>' }])
  })

  it('takes the facts of a request from the request', () => {
    expect(factsOfRequest({ type: 'getProperties' })).toEqual({ type: 'other', tag: 'getProperties' })
    expect(factsOfRequest({ type: 'getProperties', device: 'Cam', name: 'GAIN' })).toEqual({ type: 'other', tag: 'getProperties', indiDevice: 'Cam', property: 'GAIN' })
    expect(factsOfRequest({ type: 'pingReply', uid: '7' })).toEqual({ type: 'other', tag: 'pingReply' })
    expect(factsOfRequest({ type: 'new', kind: 'switch', device: 'Cam', name: 'CONNECTION', values: { CONNECT: true } })).toEqual({
      type: 'new',
      indiDevice: 'Cam',
      property: 'CONNECTION',
      elements: { CONNECT: true },
    })
  })
})
