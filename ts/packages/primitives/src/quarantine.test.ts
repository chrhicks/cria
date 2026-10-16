import { describe, expect, it } from 'vitest'
import { quarantineOf } from './quarantine.js'

const confirmed = (settledAt: number) => ({ outcome: { kind: 'confirmed', value: {} } as const, settledAt })
const uncertain = (message: string, settledAt: number) => ({ outcome: { kind: 'uncertain', reason: 'no-acknowledgement', message } as const, settledAt })

describe('quarantineOf', () => {
  it('is released while nothing since the last recovery ended uncertain', () => {
    expect(quarantineOf([confirmed(1), { outcome: { kind: 'failed', reason: 'busy', message: 'busy' }, settledAt: 2 }, { outcome: { kind: 'stopped' }, settledAt: 3 }])).toEqual({ held: false })
  })

  it('is held from the first uncertain ending, and a confirmed stop after it does not release it', () => {
    expect(quarantineOf([confirmed(1), uncertain('slew not acknowledged', 10), confirmed(20), uncertain('stop lost', 30)])).toEqual({
      held: true,
      reason: 'slew not acknowledged',
      since: 10,
    })
  })
})
