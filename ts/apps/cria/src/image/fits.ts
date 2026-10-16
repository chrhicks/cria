/**
 * Image boundary: FITS (what INDI cameras send) to ASCOM ImageBytes v1 (what
 * Vela decodes today). One pass over the pixels; no processing, scaling or
 * debayering, which belong in Vela.
 *
 * FITS stores rows (x fastest), big-endian; ImageBytes stores columns (y
 * fastest), little-endian, behind a 44-byte header. INDI writes row 0 as the
 * first row read from the sensor, the same row ASCOM calls y = 0.
 */

export class FitsError extends Error {
  override readonly name = 'FitsError'
}

export interface ConvertedImage {
  readonly bytes: Buffer
  readonly width: number
  readonly height: number
  /** From DATE-OBS when the driver wrote it. */
  readonly capturedAt?: number
}

const block = 2880
const card = 80
const headerBytes = 44

/** ImageBytes element type codes. */
const elementType = { int16: 1, int32: 2, byte: 6, uint16: 8 } as const

export function readFitsHeader(fits: Buffer): { cards: Map<string, string>; dataStart: number } {
  const cards = new Map<string, string>()

  for (let offset = 0; offset + card <= fits.length; offset += card) {
    const line = fits.toString('latin1', offset, offset + card)
    const key = line.slice(0, 8).trim()

    if (key === 'END') return { cards, dataStart: Math.ceil((offset + card) / block) * block }
    if (line[8] === '=') cards.set(key, line.slice(10).split('/')[0]!.trim().replace(/^'(.*)'$/, '$1').trim())
  }

  throw new FitsError('FITS header has no END card')
}

function integerCard(cards: Map<string, string>, key: string, fallback?: number): number {
  const text = cards.get(key)

  if (text === undefined) {
    if (fallback !== undefined) return fallback
    throw new FitsError(`FITS header lacks ${key}`)
  }

  const value = Number(text)

  if (!Number.isFinite(value)) throw new FitsError(`FITS ${key} is not a number`)

  return value
}

export function fitsToImageBytes(fits: Buffer, expected: { readonly width: number; readonly height: number }): ConvertedImage {
  const { cards, dataStart } = readFitsHeader(fits)
  const bitpix = integerCard(cards, 'BITPIX')
  const axes = integerCard(cards, 'NAXIS')
  const width = integerCard(cards, 'NAXIS1')
  const height = integerCard(cards, 'NAXIS2')
  const zero = integerCard(cards, 'BZERO', 0)
  const scale = integerCard(cards, 'BSCALE', 1)

  if (axes !== 2) throw new FitsError(`Only two-dimensional frames are supported (NAXIS ${axes})`)
  if (width !== expected.width || height !== expected.height)
    throw new FitsError(`Frame is ${width}x${height}, the camera reported ${expected.width}x${expected.height}`)
  if (scale !== 1) throw new FitsError('Scaled FITS data is not supported')

  const pixels = width * height
  const source = sourceFormat(bitpix, zero)

  if (fits.length < dataStart + pixels * source.size) throw new FitsError('FITS data is truncated')

  const bytes = Buffer.alloc(headerBytes + pixels * source.size)
  const header = [1, 0, 0, 0, headerBytes, elementType.int32, source.transmission, 2, width, height, 0]

  header.forEach((value, index) => bytes.writeInt32LE(value, index * 4))
  transpose(fits.subarray(dataStart, dataStart + pixels * source.size), bytes.subarray(headerBytes), width, height, source)

  const capturedAt = dateObs(cards.get('DATE-OBS'))

  return capturedAt === undefined ? { bytes, width, height } : { bytes, width, height, capturedAt }
}

interface SourceFormat {
  readonly size: 1 | 2 | 4
  readonly transmission: number
  /** Added to every sample after byte-swapping (16-bit unsigned data is stored offset by 32768). */
  readonly flip: number
}

function sourceFormat(bitpix: number, zero: number): SourceFormat {
  if (bitpix === 16 && zero === 32768) return { size: 2, transmission: elementType.uint16, flip: 0x8000 }
  if (bitpix === 16 && zero === 0) return { size: 2, transmission: elementType.int16, flip: 0 }
  if (bitpix === 8 && zero === 0) return { size: 1, transmission: elementType.byte, flip: 0 }
  if (bitpix === 32 && zero === 0) return { size: 4, transmission: elementType.int32, flip: 0 }

  throw new FitsError(`Unsupported FITS sample format (BITPIX ${bitpix}, BZERO ${zero})`)
}

/**
 * Rows (big-endian) to columns (little-endian). Swaps bytes once into a copy,
 * then copies samples through typed arrays: about 26 M samples for an
 * ASI2600 frame, so per-sample Buffer calls are too slow for the rig PC.
 */
function transpose(rows: Buffer, columns: Buffer, width: number, height: number, source: SourceFormat) {
  const swapped = Buffer.from(rows)

  if (source.size === 2) swapped.swap16()
  if (source.size === 4) swapped.swap32()

  const input = typed(swapped, source.size)
  const output = typed(columns, source.size)
  const flip = source.flip

  for (let y = 0; y < height; y++) {
    const row = y * width

    for (let x = 0; x < width; x++) output[x * height + y] = input[row + x]! ^ flip
  }
}

function typed(buffer: Buffer, size: 1 | 2 | 4): Uint8Array | Uint16Array | Int32Array {
  // Buffer.from and Buffer.alloc of this size own their memory at offset 0, so the views are aligned.
  if (size === 1) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)
  if (size === 2) return new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2)

  return new Int32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
}

function dateObs(text: string | undefined): number | undefined {
  if (!text) return undefined
  const value = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`)

  return Number.isFinite(value) ? value : undefined
}
