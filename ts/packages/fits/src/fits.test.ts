import { describe, expect, it } from 'vitest'
import { FitsError, readFitsCards, readFitsHeader, startedAt } from './fits.js'

function fits(cards: ReadonlyArray<string>, data: Buffer): Buffer {
  const header = Buffer.from([...cards, 'END'].map(card => card.padEnd(80)).join('').padEnd(2880))
  const padded = Buffer.alloc(Math.ceil(data.length / 2880) * 2880)

  data.copy(padded)

  return Buffer.concat([header, padded])
}

const card = (key: string, value: string | number) => `${key.padEnd(8)}= ${String(value).padStart(20)}`

describe('startedAt', () => {
  it('reads DATE-OBS as UTC, with or without a zone, and is undefined without it', () => {
    const cards = (date?: string) => readFitsHeader(fits([card('SIMPLE', 'T'), ...(date ? [card('DATE-OBS', `'${date}'`)] : [])], Buffer.alloc(0))).cards

    expect([startedAt(cards('2026-11-07T16:30:14.250')), startedAt(cards('2026-11-07T16:30:14.250Z')), startedAt(cards())]).toEqual([
      Date.UTC(2026, 10, 7, 16, 30, 14, 250),
      Date.UTC(2026, 10, 7, 16, 30, 14, 250),
      undefined,
    ])
  })
})

describe('readFitsCards', () => {
  const header = (lines: ReadonlyArray<string>) => Buffer.from(lines.map(line => line.padEnd(80)).join('').padEnd(2880))

  it('keeps every card as written, comments and COMMENT lines included, up to END', () => {
    const cards = ['SIMPLE  =                    T / conforms', 'COMMENT from the camera', "OBJECT  = 'M31 / core'"]

    expect(readFitsCards(header([...cards, 'END', 'AFTER   =                    1']))).toEqual(cards)
  })

  it('refuses a header with no END', () => {
    expect(() => readFitsCards(header(['SIMPLE  =                    T']))).toThrow(FitsError)
  })
})
