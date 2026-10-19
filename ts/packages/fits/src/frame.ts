/**
 * A 16-bit FITS frame whose pixel (x, y) is `base + x + 10 * y`, with the
 * EXPTIME and DATE-OBS keywords INDI's CCD base class writes.
 */
export function fitsFrame(width: number, height: number, frame: { exptime?: number; startedAt?: number; base?: number } = {}): Buffer {
  const started = new Date(frame.startedAt ?? Date.now()).toISOString().replace('Z', '')
  const cards = [
    'SIMPLE  =                    T',
    'BITPIX  =                   16',
    'NAXIS   =                    2',
    `NAXIS1  = ${String(width).padStart(20)}`,
    `NAXIS2  = ${String(height).padStart(20)}`,
    'BZERO   =                32768',
    'BSCALE  =                    1',
    `EXPTIME = ${(frame.exptime ?? 1).toExponential(6).toUpperCase().padStart(20)}`,
    `DATE-OBS= '${started}'`,
    'END',
  ]
  const header = Buffer.from(cards.map(card => card.padEnd(80)).join('').padEnd(2880))
  const data = Buffer.alloc(Math.ceil((width * height * 2) / 2880) * 2880)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.writeInt16BE((frame.base ?? 0) + x + 10 * y - 32768, (y * width + x) * 2)
  }

  return Buffer.concat([header, data])
}
