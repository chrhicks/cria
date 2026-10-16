import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect } from 'vitest'
import * as Reading from './reading.js'

describe('Reading.required', () => {
  it.effect('gives the value of a fresh Reading', () =>
    Effect.gen(function* () {
      expect(yield* Reading.required(Reading.fresh(5, 100), 'position')).toBe(5)
    }))

  it.effect('fails unavailable for a stale Reading and for one that was not read', () =>
    Effect.gen(function* () {
      const stale = yield* Effect.flip(Reading.required(Reading.stale(5, 100), 'position'))
      const notRead = yield* Effect.flip(Reading.required(Reading.unavailable('not-read'), 'position'))

      expect(stale).toMatchObject({ reason: 'unavailable', message: 'position is not currently known' })
      expect(notRead).toMatchObject({ reason: 'unavailable' })
    }))

  it.effect('fails unsupported when the device does not have the fact', () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(Reading.required(Reading.unavailable('unsupported'), 'setpoint'))

      expect(failed).toMatchObject({ reason: 'unsupported', message: 'setpoint is not supported by this device' })
    }))
})
