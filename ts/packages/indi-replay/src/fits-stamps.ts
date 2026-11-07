import { readFitsCards, readFitsHeader } from '@cria/fits'

const block = 2880
const card = 80

export interface Exposure {
  readonly seconds: number
  readonly startedAt: number
}

export function withExposure(fits: Buffer, exposure: Exposure): Buffer {
  const exptime = String(exposure.seconds)

  if (exptime.length > 20) throw new Error(`EXPTIME ${exptime} does not fit a FITS card`)

  const replacement = new Map([
    ['EXPTIME', `EXPTIME = ${exptime.padStart(20)}`],
    ['DATE-OBS', `DATE-OBS= '${new Date(exposure.startedAt).toISOString().slice(0, -1)}'`],
  ])
  const kept = readFitsCards(fits).filter(line => !['CHECKSUM', 'DATASUM'].includes(line.slice(0, 8).trim()))
  const written = new Set<string>()
  const rewritten = kept.map(line => {
    const key = line.slice(0, 8).trim()
    const next = replacement.get(key)

    if (next === undefined || written.has(key)) return line
    written.add(key)

    return next
  })

  for (const [key, line] of replacement) if (!written.has(key)) rewritten.push(line)

  const text = [...rewritten.map(line => line.padEnd(card)), 'END'.padEnd(card)].join('')
  const header = Buffer.from(text.padEnd(Math.ceil(text.length / block) * block), 'latin1')

  return Buffer.concat([header, fits.subarray(readFitsHeader(fits).dataStart)])
}

export function flattened(fits: Buffer): Buffer {
  const { cards, dataStart } = readFitsHeader(fits)
  const bytes = Math.abs(Number(cards.get('BITPIX'))) / 8
  const pixels = Number(cards.get('NAXIS1')) * Number(cards.get('NAXIS2'))
  const out = Buffer.from(fits)

  out.fill(Buffer.from(fits.subarray(dataStart, dataStart + bytes)), dataStart, dataStart + pixels * bytes)

  return out
}
