/**
 * The one rule for "the mount has stopped" (capability/stopped.ts), on readings alone: which ones count, and when
 * they show the position no longer changing. The same rule against the AM5's recorded motions, through Cria's
 * real mount code, is `am5-motion.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { stoppedAt, type Command, type Reading } from '../src/capability/stopped.js'

const rule = { windowMs: 1480, stationaryDegrees: 0.02 }
const sentAt = 10_000
const before = { ra: 150, dec: 40 }
const command: Command = { sentAt, before }
const reading = (msAfter: number, ra: number, dec = 40): Reading => ({ at: sentAt + msAfter, ra, dec })

describe('stopped', () => {
  it('needs the position unchanged across a window of readings', () => {
    expect(stoppedAt([reading(100, 151), reading(1600, 151)], command, rule)).toEqual({ ra: 151, dec: 40 })
  })

  it('is not stopped on one reading, or on readings closer together than the window', () => {
    expect(stoppedAt([reading(100, 151)], command, rule)).toBeUndefined()
    expect(stoppedAt([reading(100, 151), reading(900, 151)], command, rule)).toBeUndefined()
  })

  it('is not stopped while the position still changes, whatever the property says', () => {
    expect(stoppedAt([reading(100, 151), reading(1600, 151.5)], command, rule)).toBeUndefined()
    expect(stoppedAt([reading(100, 151, 40), reading(1600, 151, 40.05)], command, rule)).toBeUndefined()
  })

  it('is stopped after the position settles, not at its first still pair', () => {
    const coast = [reading(100, 151), reading(1600, 152), reading(3100, 152.01)]

    expect(stoppedAt(coast.slice(0, 2), command, rule)).toBeUndefined()
    expect(stoppedAt(coast, command, rule)).toEqual({ ra: 152.01, dec: 40 })
  })

  it('looks at every reading in the window, not only its ends', () => {
    expect(stoppedAt([reading(100, 151), reading(800, 153), reading(1600, 151)], command, rule)).toBeUndefined()
  })

  it('compares RA across 0 and 360', () => {
    expect(stoppedAt([reading(100, 359.995), reading(1600, 0.005)], { sentAt }, rule)).toEqual({ ra: 0.005, dec: 40 })
  })

  it('ignores a reading that arrived before the command, or at the moment it was sent', () => {
    expect(stoppedAt([reading(-1500, 151), reading(0, 151), reading(100, 151)], command, rule)).toBeUndefined()
    expect(stoppedAt([reading(-1500, 151), reading(100, 151), reading(1600, 151)], command, rule)).toEqual({ ra: 151, dec: 40 })
  })

  it('ignores a reply in the first window that repeats the position held when the command went out', () => {
    const stale = reading(100, before.ra, before.dec)

    expect(stoppedAt([stale, reading(1600, before.ra, before.dec)], command, rule)).toBeUndefined()
    expect(stoppedAt([stale, reading(900, before.ra, before.dec), reading(1600, 152), reading(3100, 152)], command, rule)).toEqual({ ra: 152, dec: 40 })
  })

  it('accepts the held position once the first window is over: the driver has polled since', () => {
    expect(stoppedAt([reading(100, before.ra, before.dec), reading(1600, before.ra, before.dec), reading(3100, before.ra, before.dec)], command, rule)).toEqual(before)
  })

  it('has no old value to ignore when the mirror held no position', () => {
    expect(stoppedAt([reading(100, 150), reading(1600, 150)], { sentAt }, rule)).toEqual({ ra: 150, dec: 40 })
  })
})
