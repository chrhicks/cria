/**
 * Image boundary: the FITS header INDI cameras write. Cria serves the frame as
 * the camera delivered it and reads only the header.
 */

export class FitsError extends Error {
  override readonly name = 'FitsError'
}

const block = 2880
const card = 80

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

export function readFitsCards(fits: Buffer): ReadonlyArray<string> {
  const cards: Array<string> = []

  for (let offset = 0; offset + card <= fits.length; offset += card) {
    const line = fits.toString('latin1', offset, offset + card).trimEnd()

    if (line === 'END') return cards
    if (line !== '') cards.push(line)
  }

  throw new FitsError('FITS header has no END card')
}

export function startedAt(cards: Map<string, string>): number | undefined {
  const text = cards.get('DATE-OBS')

  if (!text) return undefined
  const value = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`)

  return Number.isFinite(value) ? value : undefined
}
