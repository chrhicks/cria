import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IndiFramer, parseNumber, serialize, type IndiMessage } from './xml.js'
import { Mirror, selectedSwitch } from './mirror.js'

// Real traffic from indiserver 2.2.5 with the CCD, telescope, focuser and
// weather simulators: definitions, a 64x48 exposure with its BLOB, a focuser
// move and a weather disconnect (which deletes properties).
const recorded = readFileSync(new URL('./fixtures/simulators.xml', import.meta.url))

function parseInChunks(bytes: Buffer, sizes: () => number): IndiMessage[] {
  const framer = new IndiFramer()
  const messages: IndiMessage[] = []

  for (let at = 0; at < bytes.length; ) {
    const size = Math.max(1, sizes())

    messages.push(...framer.push(bytes.subarray(at, at + size)))
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

  it('decodes the exposure BLOB to the FITS file the simulator wrote', () => {
    const blob = whole.find(message => message.type === 'set' && message.vector.kind === 'blob' && message.vector.elements.length > 0)

    expect(blob?.type).toBe('set')
    if (blob?.type !== 'set') return
    const element = blob.vector.elements[0]!

    expect(element.kind).toBe('blob')
    if (element.kind !== 'blob') return
    expect(element.format).toBe('.fits')
    expect(element.data.length).toBe(element.size)
    expect(element.data.toString('latin1', 0, 9)).toBe('SIMPLE  =')
  })

  it('builds a mirror that knows the current values and deletes what the driver removed', () => {
    const mirror = new Mirror()

    for (const message of whole) mirror.apply(message, 0)

    expect(mirror.property('Focuser Simulator', 'ABS_FOCUS_POSITION')?.elements.get('FOCUS_ABSOLUTE_POSITION')).toMatchObject({ value: 50200 })
    expect(selectedSwitch(mirror.property('Telescope Simulator', 'TELESCOPE_TRACK_MODE'))).toBe('TRACK_SIDEREAL')
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
    const [definition, update] = framer.push(
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
    const [message] = new IndiFramer().push(
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
  const blobVector = (elements: string) => `<setBLOBVector device="CCD" name="CCD1" state="Ok" timestamp="2026-10-18T01:02:03">${elements}</setBLOBVector>`

  it('keeps an element ignored by the parser, with its wire text', () => {
    const framed = new IndiFramer().pushFramed(Buffer.from('<message device="CCD" message="hello &amp; bye"/>'))

    expect(framed).toEqual([{ message: undefined, xml: '<message device="CCD" message="hello &amp; bye"/>', blobs: [] }])
  })

  it('elides every BLOB payload and hands back the decoded bytes in document order', () => {
    const wire = blobVector(
      '<oneBLOB name="CCD1" size="3" format=".fits">AQID</oneBLOB><oneBLOB name="CCD2" size="2" format=".fits">\nBAU=\n</oneBLOB>',
    )
    const [element] = new IndiFramer().pushFramed(Buffer.from(wire))

    expect(element!.xml).toBe(blobVector('<oneBLOB name="CCD1" size="3" format=".fits"/><oneBLOB name="CCD2" size="2" format=".fits"/>'))
    expect(element!.blobs.map(blob => [...blob])).toEqual([[1, 2, 3], [4, 5]])
  })

  it('keeps a self-closing oneBLOB in place and counts it as an empty payload', () => {
    const [element] = new IndiFramer().pushFramed(
      Buffer.from(blobVector('<oneBLOB name="A" size="0" format=".fits"/><oneBLOB name="B" size="1" format=".fits">AQ==</oneBLOB>')),
    )

    expect(element!.xml).toBe(blobVector('<oneBLOB name="A" size="0" format=".fits"/><oneBLOB name="B" size="1" format=".fits"/>'))
    expect(element!.blobs.map(blob => [...blob])).toEqual([[], [1]])
  })

  it('frames real indiserver traffic the same however the bytes are split, and never changes what push returns', () => {
    const whole = new IndiFramer().pushFramed(recorded)

    expect(whole.map(element => element.message).filter(message => message !== undefined)).toEqual(parseInChunks(recorded, () => recorded.length))

    for (const seed of [3, 11, 99]) {
      const framer = new IndiFramer()
      const sizes = chunkSizes(seed)
      const split = []

      for (let at = 0; at < recorded.length; ) {
        const size = Math.max(1, sizes())

        split.push(...framer.pushFramed(recorded.subarray(at, at + size)))
        at += size
      }

      expect(split.map(element => element.xml)).toEqual(whole.map(element => element.xml))
      expect(split.map(element => element.blobs.map(blob => blob.toString('base64')))).toEqual(whole.map(element => element.blobs.map(blob => blob.toString('base64'))))
    }
  })

  it('gives the exposure BLOB of the real traffic as one elided element and the FITS bytes', () => {
    const framed = new IndiFramer().pushFramed(recorded).filter(element => element.blobs.some(blob => blob.length > 0))

    expect(framed).toHaveLength(1)
    expect(framed[0]!.xml).toBe(
      '<setBLOBVector device="CCD Simulator" name="CCD1" state="Ok" timeout="60" timestamp="2026-10-15T03:27:32">\n' +
        '    <oneBLOB name="CCD1" size="14400" format=".fits" len="14400"/>\n' +
        '</setBLOBVector>',
    )
    expect(framed[0]!.blobs[0]!.toString('latin1', 0, 6)).toBe('SIMPLE')
  })
})
