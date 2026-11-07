import { describe, expect, it } from 'vitest'
import { fitsToImageBytes, readFitsHeader } from '@cria/fits'
import { flattened, withExposure } from './fits-stamps.js'

function fits(cards: ReadonlyArray<string>, data: Buffer): Buffer {
  const header = Buffer.from([...cards, 'END'].map(card => card.padEnd(80)).join('').padEnd(2880))
  const padded = Buffer.alloc(Math.ceil(data.length / 2880) * 2880)

  data.copy(padded)

  return Buffer.concat([header, padded])
}

const card = (key: string, value: string | number) => `${key.padEnd(8)}= ${String(value).padStart(20)}`

const unsigned16 = (extra: ReadonlyArray<string> = [], keep = 12) =>
  fits(
    [card('SIMPLE', 'T'), card('BITPIX', 16), card('NAXIS', 2), card('NAXIS1', 3), card('NAXIS2', 2), card('BZERO', 32768), card('BSCALE', 1), ...extra],
    Buffer.from('80018002800383e983ea83eb', 'hex').subarray(0, keep),
  )

describe('withExposure', () => {
  const stamped = (extra: ReadonlyArray<string> = []) =>
    unsigned16([`EXPTIME = ${'1'.padStart(20)}`, `DATE-OBS= '2026-10-15T01:02:03.500'`, `CHECKSUM= 'abcdefgh12345678'`, ...extra, `DATASUM = '123'`])

  it('replaces EXPTIME and DATE-OBS, drops CHECKSUM and DATASUM, and keeps the data bytes', () => {
    const source = stamped()
    const copy = withExposure(source, { seconds: 2.5, startedAt: Date.parse('2026-10-18T22:30:05.250Z') })
    const { cards, dataStart } = readFitsHeader(copy)

    expect(cards.get('EXPTIME')).toBe('2.5')
    expect(cards.get('DATE-OBS')).toBe('2026-10-18T22:30:05.250')
    expect([...cards.keys()]).toEqual(['SIMPLE', 'BITPIX', 'NAXIS', 'NAXIS1', 'NAXIS2', 'BZERO', 'BSCALE', 'EXPTIME', 'DATE-OBS'])
    expect(copy.subarray(dataStart).equals(source.subarray(readFitsHeader(source).dataStart))).toBe(true)
    expect(fitsToImageBytes(copy, { width: 3, height: 2 })).toMatchObject({ capturedAt: Date.parse('2026-10-18T22:30:05.250Z') })
  })

  it('adds the two cards before END when the source has neither', () => {
    const copy = withExposure(unsigned16(), { seconds: 1, startedAt: 0 })

    expect([...readFitsHeader(copy).cards.entries()].slice(-2)).toEqual([['EXPTIME', '1'], ['DATE-OBS', '1970-01-01T00:00:00.000']])
  })

  it('grows the header by a whole block when it has no room', () => {
    const crowded = Array.from({ length: 28 }, (_, index) => `KEY${index}`.padEnd(8) + '= 1')
    const source = unsigned16(crowded)
    const copy = withExposure(source, { seconds: 1, startedAt: 0 })

    expect(readFitsHeader(source).dataStart).toBe(2880)
    expect(copy.length).toBe(2880 * 3)
    expect(readFitsHeader(copy).dataStart).toBe(2880 * 2)
    expect(fitsToImageBytes(copy, { width: 3, height: 2 }).bytes).toEqual(fitsToImageBytes(source, { width: 3, height: 2 }).bytes)
  })
})

describe('flattened', () => {
  it('sets every pixel to the first one and leaves the header alone', () => {
    const source = unsigned16()
    const flat = flattened(source)

    expect(flat.subarray(0, 2880).equals(source.subarray(0, 2880))).toBe(true)
    expect(flat.subarray(2880, 2880 + 12).toString('hex')).toBe('800180018001800180018001')
  })
})
