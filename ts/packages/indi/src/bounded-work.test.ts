import { describe, expect, it } from 'vitest'
import { IndiFramer, parseAttributes, type FramedElement } from './xml.js'

// All names, values and text in this file are invented.

/** Feeds `wire` in chunks and returns what came out, with the slowest single `frame` call. */
function deliver(wire: Buffer, size: number, framer = new IndiFramer(), keepText = false) {
  const results = []
  let slowest = 0

  for (let at = 0; at < wire.length; at += size) {
    const began = performance.now()
    const result = framer.frame(wire.subarray(at, at + size), keepText)

    slowest = Math.max(slowest, performance.now() - began)
    results.push(result)
    if (result.stopped) break
  }

  return { elements: results.flatMap(result => result.elements), stopped: results.find(result => result.stopped)?.stopped, slowest }
}

describe('a tag that never ends costs work in proportion to the bytes, not their square', () => {
  const over = 8 * 1024 * 1024 + 1024
  const filler = (unit: string) => unit.repeat(Math.ceil(over / unit.length))
  const hostile: Array<[string, string]> = [
    ['plain text', `<defTextVector device="D" name="N" ${'x'.repeat(over)}`],
    ['attribute-like text', `<a ${filler('b=" ')}`],
    ['both quote kinds, none closed', `<a ${filler('b=\' c=" ')}`],
    ['one enormous word', `<a ${'b'.repeat(over)}`],
    ['a name with no value, again and again', `<a ${filler('b ')}`],
    ['equals signs and spaces', `<a b${filler(' = ')}`],
    ['a comment-like tag that is not a comment', `<!-${filler('-- ')}`],
    ['an unfinished comment', `<!-- ${filler('-- ')}`],
    ['dots and dashes in names', `<a ${filler('b.-b-.')}`],
  ]

  it.each(hostile)('drops the connection for %s, whole or in chunks, within a small time budget', (_, text) => {
    const wire = Buffer.from(text)

    for (const size of [wire.length, 64 * 1024]) {
      const began = performance.now()
      const { elements, stopped } = deliver(wire, size)
      const took = performance.now() - began

      expect(elements, `chunks of ${size}`).toHaveLength(0)
      expect(stopped, `chunks of ${size}`).toMatchObject({ scope: 'stream', reason: expect.stringMatching(/larger than 8388608 bytes/) })
      expect(stopped!.excerpt.length, `chunks of ${size}`).toBeLessThan(1300)
      expect(took, `chunks of ${size}: ${took.toFixed(0)} ms`).toBeLessThan(2000)
    }
  }, 30_000)

  it('takes about four times as long for four times the bytes', () => {
    const time = (bytes: number) => {
      const framer = new IndiFramer({ element: bytes - 1, blob: bytes - 1 })
      const wire = Buffer.from(`<a ${'b.-'.repeat(Math.ceil(bytes / 3))}`)
      const began = performance.now()
      const { stopped } = deliver(wire, wire.length, framer)

      expect(stopped).toMatchObject({ scope: 'stream' })

      return performance.now() - began
    }

    time(1 << 15)
    const small = time(1 << 15)
    const large = time(1 << 17)

    // Linear is about 4, quadratic about 16.
    expect(large, `${small.toFixed(1)} ms then ${large.toFixed(1)} ms`).toBeLessThan(Math.max(small, 5) * 9)
  })
})

describe('what is read of a bad element does not depend on how big it is', () => {
  it('names the device and property from the start of a huge element, and cuts no character in two', () => {
    // Pad so that a three-byte character straddles the 4096th byte, whichever way it is cut.
    for (const pad of [0, 1, 2]) {
      const head = `<defTextVector state="Nope" device="Scope \u00e9\u20ac" name="N\u00e9" x="${'y'.repeat(4000 + pad)}\u20ac\u20ac"`
      const wire = `${head}>${'z'.repeat(2 * 1024 * 1024)}</defTextVector>`
      const { elements } = new IndiFramer().frame(Buffer.from(wire), false)

      expect(elements[0]!.problem, `pad ${pad}`).toMatchObject({ tag: 'defTextVector', device: 'Scope \u00e9\u20ac', name: 'N\u00e9', utf8: true, bytes: Buffer.byteLength(wire) })
    }
  })

  it('never shows the start of a BLOB payload that is cut by the inspected prefix', () => {
    const wire = `<setBLOBVector device="D" name="CCD1" state="Broken"><oneBLOB name="CCD1" size="9" format=".fits">${'QUJD'.repeat(2_000_000)}</oneBLOB></setBLOBVector>`
    const { elements } = new IndiFramer().frame(Buffer.from(wire), false)

    expect(elements[0]!.problem).toMatchObject({ tag: 'setBLOBVector', device: 'D', name: 'CCD1', reason: expect.stringMatching(/Unknown INDI state/) })
    expect(elements[0]!.problem!.excerpt).not.toContain('QUJD')
    expect(elements[0]!.problem!.excerpt).toContain('<oneBLOB name=\\"CCD1\\"')
  })

  it('still sees invalid UTF-8 in the start of the element', () => {
    const wire = Buffer.concat([Buffer.from('<defTextVector device="D\u00e9" name="N" state="Nope" perm="ro">'), Buffer.from([0xff]), Buffer.from(`${'z'.repeat(100_000)}</defTextVector>`)])

    expect(new IndiFramer().frame(wire, false).elements[0]!.problem).toMatchObject({ utf8: false, device: 'D\u00e9' })
  })
})

describe('reading attributes', () => {
  /** What the attribute reader was before it was one pass: a regex tried again from every letter. */
  function regexAttributes(text: string) {
    const attributes: Record<string, string> = {}

    for (const match of text.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) attributes[match[1]!] = match[3] ?? match[4] ?? ''

    return attributes
  }

  it('reads exactly what the regex did, on random text made of its awkward pieces', () => {
    const pieces = ['a', 'b', '_', '1', '.', '-', '=', ' ', '\t', '\n', '\u00a0', '"', "'", '<', '>', 'x="v"', "y='w'", 'z =  "', "q = '", '/', '\u00e9']
    let state = 7

    const next = (bound: number) => {
      state = (state * 1103515245 + 12345) % 2 ** 31

      return Math.floor((state / 2 ** 31) * bound)
    }

    for (let round = 0; round < 30_000; round += 1) {
      const text = Array.from({ length: next(30) }, () => pieces[next(pieces.length)]).join('')

      expect(parseAttributes(text), JSON.stringify(text)).toEqual(regexAttributes(text))
    }
  })

  it('reads a few awkward ones the way a person would', () => {
    expect(parseAttributes(' device = "A b" name=\'N\' 1x="no" y-z.w="&amp;" lone q="open')).toEqual({ device: 'A b', name: 'N', x: 'no', 'y-z.w': '&' })
    expect(parseAttributes('a=" b=\'c\'')).toEqual({ b: 'c' })
  })
})

describe('a stream of valid and malformed input, however it is chunked', () => {
  const pick = <T,>(random: () => number, items: ReadonlyArray<T>) => items[Math.floor(random() * items.length)]!

  function corpus(seed: number) {
    let state = seed
    const random = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31

      return state / 2 ** 31
    }
    const word = () => Array.from({ length: 1 + Math.floor(random() * 12) }, () => pick(random, [...'abcdefgh XYZ019_.-\u00e9\u20ac\u{1f52d}'])).join('')
    const parts: string[] = []

    for (let i = 0; i < 400; i += 1) {
      const device = word().replace(/ /g, '_')
      const name = word().replace(/ /g, '_')
      const state = pick(random, ['Idle', 'Ok', 'Busy', 'Alert', 'Nope'])
      const value = pick(random, ['1', '2.5', '-3:30:15', 'junk', '', word()])

      parts.push(
        pick(random, [
          `<defNumberVector device="${device}" name="${name}" state="${state}" perm="rw"><defNumber name="n" min="0" max="9" step="1">${value}</defNumber></defNumberVector>`,
          `<setTextVector device="${device}" name="${name}"><oneText name="t">${value}&amp;${word()}</oneText></setTextVector>`,
          `<setSwitchVector device="${device}" name="${name}" state="${state}"><oneSwitch name="s">${pick(random, ['On', 'Off', 'Maybe'])}</oneSwitch></setSwitchVector>`,
          `<delProperty device="${device}"${random() < 0.5 ? ` name="${name}"` : ''}/>`,
          `<setBLOBVector device="${device}" name="${name}" state="${state}"><oneBLOB name="B" size="9" format=".fits">${'QUJD'.repeat(Math.floor(random() * 50))}</oneBLOB></setBLOBVector>`,
          `<message device="${device}" message="${word()}"/>`,
          `<!-- ${word()} > ${random() < 0.5 ? '--' : ''} -->`,
          `<?xml version="1.0"?>`,
          `<bogus device="${device}" name="${name}" ${'k="v" '.repeat(Math.floor(random() * 40))}/>`,
          `<defTextVector name="${name}" state="Idle" perm="ro"/>`,
        ]),
      )
    }

    return Buffer.from(parts.join(pick(random, ['', '\n'])))
  }

  const summary = (elements: FramedElement[]) =>
    elements.map(element => JSON.stringify({ message: element.message, problem: element.problem, xml: element.xml, blobs: element.blobs.map(blob => blob.toString('hex')) }))

  it('gives the same elements for chunks of 1, 7 and 64 KiB, and no single call is slow', () => {
    for (const seed of [1, 2, 3]) {
      const wire = corpus(seed)
      const results = [1, 7, 64 * 1024, wire.length].map(size => {
        const { elements, stopped, slowest } = deliver(wire, size, new IndiFramer(), true)

        expect(slowest, `chunks of ${size}`).toBeLessThan(250)

        return { elements: summary(elements), stopped }
      })

      expect(results[0]!.elements.length).toBeGreaterThan(300)
      expect(results[0]!.stopped).toBeUndefined()
      for (const result of results) expect(result).toEqual(results[0])
    }
  })

  it('gives the same elements and the same stop for a corpus that ends in a tag that never ends', () => {
    const limits = { element: 20_000, blob: 40_000 }

    for (const ending of ['<a b=" b=" ' + 'b=" '.repeat(6000), '<defTextVector device="D" ' + 'x'.repeat(30_000), '<!-- ' + 'y'.repeat(30_000), '<!-- > ' + 'y'.repeat(30_000)]) {
      const wire = Buffer.concat([corpus(9), Buffer.from(ending)])
      const results = [1, 7, 64 * 1024].map(size => {
        const { elements, stopped, slowest } = deliver(wire, size, new IndiFramer(limits), true)

        expect(slowest, `chunks of ${size}`).toBeLessThan(250)

        // `bytes` is how much was buffered when the limit was crossed, which is the chunk that crossed it.
        return { elements: summary(elements), stopped: { ...stopped, bytes: 0 } }
      })

      expect(results[0]!.stopped, ending.slice(0, 8)).toMatchObject({ scope: 'stream', reason: expect.stringMatching(/larger than 20000 bytes/) })
      for (const result of results) expect(result).toEqual(results[0])
    }
  })
})
