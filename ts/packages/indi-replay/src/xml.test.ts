import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeIndi } from '@cria/fake-indi'
import { parseClientAsk, parseServerElement, type ServerElement } from './xml.js'

const fixture = readFileSync(join(import.meta.dirname, '..', '..', '..', 'apps', 'cria', 'test', 'fixtures', 'errai-2026-10-15.xml'), 'utf8')
const elements = [...fixture.matchAll(/<(def\w+Vector)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g)].map(match => match[0])

const definitions = (parsed: ReadonlyArray<ServerElement | undefined>) =>
  parsed.flatMap(element => (element?.kind === 'define' ? [element.vector] : []))

describe('definitions from the real drivers (errai, 2026-10-15)', () => {
  const parsed = elements.map(parseServerElement)

  it('reads every definition', () => {
    expect(elements).toHaveLength(fixture.match(/<def\w+Vector\b/g)!.length)
    expect(parsed.every(element => element?.kind === 'define')).toBe(true)
    expect(definitions(parsed).reduce<Record<string, number>>((count, vector) => ({ ...count, [vector.kind]: (count[vector.kind] ?? 0) + 1 }), {})).toEqual({
      switch: 119,
      number: 82,
      text: 41,
      light: 3,
      blob: 2,
    })
  })

  it('keeps what the replay must echo: rule, label, group, timeout, element labels and number limits', () => {
    const connection = definitions(parsed).find(vector => vector.device === 'ZWO EAF' && vector.name === 'CONNECTION')
    const polling = definitions(parsed).find(vector => vector.name === 'POLLING_PERIOD')

    expect(connection).toEqual({
      device: 'ZWO EAF',
      name: 'CONNECTION',
      kind: 'switch',
      perm: 'rw',
      rule: 'OneOfMany',
      label: 'Connection',
      group: 'Main Control',
      timeout: 60,
      state: 'Ok',
      elements: { CONNECT: { value: true, label: 'Connect' }, DISCONNECT: { value: false, label: 'Disconnect' } },
    })
    expect(polling?.elements.PERIOD_MS).toEqual({ value: '500', label: 'Period (ms)', min: 10, max: 600000, step: 1000, format: '%.f' })
  })

  it('writes each one back as a definition that reads the same again', () => {
    const fake = new FakeIndi()

    for (const vector of definitions(parsed)) fake.vectors.set(`${vector.device}.${vector.name}`, { ...vector })

    const again = [...fake.vectors.values()].map(vector => parseServerElement(fake.definition(vector)))
    const lastOfEach = [...new Map(definitions(parsed).map(vector => [`${vector.device}.${vector.name}`, vector])).values()]

    expect(definitions(again)).toEqual(lastOfEach)
  })
})

describe('updates and deletions', () => {
  it('reads an update with its state and values, switches as booleans and text unescaped', () => {
    expect(
      parseServerElement('<setSwitchVector device="Mount" name="TELESCOPE_TRACK_STATE" state="Ok" timeout="0"><oneSwitch name="TRACK_ON">On</oneSwitch><oneSwitch name="TRACK_OFF">Off</oneSwitch></setSwitchVector>'),
    ).toEqual({ kind: 'update', device: 'Mount', name: 'TELESCOPE_TRACK_STATE', state: 'Ok', values: { TRACK_ON: true, TRACK_OFF: false } })
    expect(parseServerElement('<setTextVector device="A &amp; B" name="X"><oneText name="T">\n  a &lt; b\n</oneText></setTextVector>')).toEqual({
      kind: 'update',
      device: 'A & B',
      name: 'X',
      values: { T: 'a < b' },
    })
  })

  it('reads an image as references, with its size and format', () => {
    expect(parseServerElement('<setBLOBVector device="CCD" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="12" format=".fits" ref="blobs/1-4-0.blob"/></setBLOBVector>')).toEqual({
      kind: 'image',
      device: 'CCD',
      name: 'CCD1',
      images: [{ element: 'CCD1', ref: 'blobs/1-4-0.blob', size: 12, format: '.fits' }],
    })
  })

  it('reads a deletion of a property and of a device', () => {
    expect(parseServerElement('<delProperty device="CCD" name="CCD1"/>')).toEqual({ kind: 'delete', device: 'CCD', name: 'CCD1' })
    expect(parseServerElement('<delProperty device="CCD"/>')).toEqual({ kind: 'delete', device: 'CCD', name: undefined })
  })

  it('does not read what is not a property: messages, ping replies, Cria\'s own commands', () => {
    for (const xml of ['<message device="CCD" message="hi"/>', '<pingReply uid="1"/>', '<newNumberVector device="CCD" name="X"/>', '']) expect(parseServerElement(xml)).toBeUndefined()
  })
})

describe('number limits a driver changes at runtime', () => {
  it('reads min, max and step from the oneNumber elements that carry them, and only those', () => {
    const parsed = parseServerElement(
      '<setNumberVector device="Focuser Simulator" name="ABS_FOCUS_POSITION" state="Ok" timeout="60" timestamp="2026-10-19T04:13:13">\n' +
        '    <oneNumber name="FOCUS_ABSOLUTE_POSITION" min="0" max="50000" step="1000">\n50000\n    </oneNumber>\n' +
        '    <oneNumber name="OTHER">\n3\n    </oneNumber>\n</setNumberVector>',
    )

    expect(parsed).toEqual({
      kind: 'update',
      device: 'Focuser Simulator',
      name: 'ABS_FOCUS_POSITION',
      state: 'Ok',
      values: { FOCUS_ABSOLUTE_POSITION: '50000', OTHER: '3' },
      limits: { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 50000, step: 1000 } },
    })
  })

  it('has no limits for an update that carries none', () => {
    expect(parseServerElement('<setNumberVector device="D" name="N" state="Ok"><oneNumber name="A">1</oneNumber></setNumberVector>')).toEqual({ kind: 'update', device: 'D', name: 'N', state: 'Ok', values: { A: '1' } })
  })
})

describe('what a client asked for', () => {
  it('reads a getProperties with or without a device and a property', () => {
    expect(parseClientAsk('<getProperties version="1.7"/>')).toEqual({ device: undefined, name: undefined })
    expect(parseClientAsk('<getProperties version="1.7" device="CCD &amp; Co" name="CCD1"/>')).toEqual({ device: 'CCD & Co', name: 'CCD1' })
    expect(parseClientAsk('<enableBLOB device="CCD">Also</enableBLOB>')).toBeUndefined()
  })
})
