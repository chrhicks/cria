import { describe, expect, it } from 'vitest'
import { FitsError, fitsToImageBytes, flattened, readFitsHeader, withExposure } from './fits.js'

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

const header = (transmission: number, width: number, height: number) =>
  Buffer.concat([1, 0, 0, 0, 44, 2, transmission, 2, width, height, 0].map(value => Buffer.from(Int32Array.of(value).buffer)))

describe('fitsToImageBytes', () => {
  it('converts 16-bit unsigned rows to little-endian columns behind the ImageBytes header', () => {
    const image = fitsToImageBytes(unsigned16([`DATE-OBS= '2026-10-15T01:02:03.500'`]), { width: 3, height: 2 })

    expect(image).toEqual({
      bytes: Buffer.concat([header(8, 3, 2), Buffer.from('0100e9030200ea030300eb03', 'hex')]),
      width: 3,
      height: 2,
      capturedAt: 1792026123500,
    })
  })

  it('converts 8-bit samples, and leaves capturedAt out without DATE-OBS', () => {
    const bytes = fits([card('SIMPLE', 'T'), card('BITPIX', 8), card('NAXIS', 2), card('NAXIS1', 2), card('NAXIS2', 2)], Buffer.from([1, 2, 3, 4]))

    expect(fitsToImageBytes(bytes, { width: 2, height: 2 })).toEqual({
      bytes: Buffer.concat([header(6, 2, 2), Buffer.from([1, 3, 2, 4])]),
      width: 2,
      height: 2,
    })
  })

  it('refuses data shorter than the frame', () => {
    expect(() => fitsToImageBytes(unsigned16([], 11).subarray(0, 2880 + 11), { width: 3, height: 2 })).toThrow(new FitsError('FITS data is truncated'))
  })

  it('refuses a frame of another size than the camera reported', () => {
    expect(() => fitsToImageBytes(unsigned16(), { width: 4, height: 2 })).toThrow(new FitsError('Frame is 3x2, the camera reported 4x2'))
  })

  it('refuses scaled data', () => {
    const scaled = fits([card('SIMPLE', 'T'), card('BITPIX', 16), card('NAXIS', 2), card('NAXIS1', 1), card('NAXIS2', 1), card('BSCALE', 2)], Buffer.alloc(2))

    expect(() => fitsToImageBytes(scaled, { width: 1, height: 1 })).toThrow(new FitsError('Scaled FITS data is not supported'))
  })

  it.each([
    [16, 100, 'Unsupported FITS sample format (BITPIX 16, BZERO 100)'],
    [-32, 0, 'Unsupported FITS sample format (BITPIX -32, BZERO 0)'],
    [32, 2147483648, 'Unsupported FITS sample format (BITPIX 32, BZERO 2147483648)'],
  ])('refuses BITPIX %i with BZERO %i', (bitpix, zero, message) => {
    const bytes = fits([card('SIMPLE', 'T'), card('BITPIX', bitpix), card('NAXIS', 2), card('NAXIS1', 1), card('NAXIS2', 1), card('BZERO', zero)], Buffer.alloc(4))

    expect(() => fitsToImageBytes(bytes, { width: 1, height: 1 })).toThrow(new FitsError(message))
  })

  it('refuses a cube, a header without NAXIS1, and a header without END', () => {
    const cube = fits([card('SIMPLE', 'T'), card('BITPIX', 8), card('NAXIS', 3), card('NAXIS1', 1), card('NAXIS2', 1), card('NAXIS3', 1)], Buffer.alloc(1))
    const noWidth = fits([card('SIMPLE', 'T'), card('BITPIX', 8), card('NAXIS', 2), card('NAXIS2', 1)], Buffer.alloc(1))
    const noEnd = Buffer.from(card('SIMPLE', 'T').padEnd(2880))

    expect(() => fitsToImageBytes(cube, { width: 1, height: 1 })).toThrow(new FitsError('Only two-dimensional frames are supported (NAXIS 3)'))
    expect(() => fitsToImageBytes(noWidth, { width: 1, height: 1 })).toThrow(new FitsError('FITS header lacks NAXIS1'))
    expect(() => fitsToImageBytes(noEnd, { width: 1, height: 1 })).toThrow(new FitsError('FITS header has no END card'))
  })
})

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
