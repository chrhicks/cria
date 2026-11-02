import { Effect, Option } from 'effect'
import type { IndiDevice } from '@cria/indi'
import type { DeviceId, ForeignMotion } from '@cria/wire'
import type { Ledger } from '../operation/ledger.js'
import { switchElement } from './fields.js'
import { angularDelta, positionOf, type Reading } from './stopped.js'

const siderealDegreesPerMs = 360 / 86_164_090.5
const axes = (ra: number, dec: number) => ({ rightAscensionDegrees: ra, declinationDegrees: dec })

/**
 * Foreign motion is cumulative axis displacement outside an open operation and its settle, after removing
 * sidereal RA drift while tracking is off. Tracking on holds RA/Dec; tracking off holds HA/Dec.
 * Use the stop rule's stationaryDegrees (AM5 default 0.02°, 72 arcsec), above the profile's 1.5 display-step
 * threshold (RA seconds of time, Dec arcseconds) and one ~1.025 s poll of drift. Source: step-03-am5-profile.
 * Do not allow a fixed coast timeout: step 17 keeps the operation open until readings prove it stopped,
 * including the recorded home's 21.5 s coast. An idle baseline never follows sub-tolerance updates, so
 * a slow hand-controller move eventually crosses the same tolerance as a large jump.
 * After reconnect, a definition may still be a placeholder; the first polled update establishes position.
 */
export function makeForeignMotion(tolerance: number) {
  let previous: Reading | undefined
  let anchor: Reading | undefined
  let residualRa = 0
  let drift = 0
  let clock: number | undefined
  let tracking: boolean | undefined

  const advance = (at: number) => {
    if (clock !== undefined && tracking === false) drift += Math.max(0, at - clock) * siderealDegreesPerMs
    clock = at
  }

  return {
    tracking(on: boolean | undefined, at: number) {
      advance(at)
      tracking = on
    },
    record(here: Reading, explained: boolean): ForeignMotion | undefined {
      if (!Number.isFinite(here.ra) || !Number.isFinite(here.dec)) return
      if (previous && here.at < previous.at) return
      advance(here.at)
      if (!previous || !anchor || explained || tracking === undefined) {
        anchor = here
        residualRa = 0
      } else {
        residualRa += angularDelta(here.ra, previous.ra) - drift
      }
      drift = 0
      previous = here
      const dec = here.dec - anchor.dec
      if (Math.abs(residualRa) <= tolerance && Math.abs(dec) <= tolerance) return
      return { at: here.at, from: axes(anchor.ra, anchor.dec), to: axes(here.ra, here.dec), unexplained: axes(residualRa, dec) }
    },
    reset() {
      previous = undefined
      anchor = undefined
      residualRa = 0
      drift = 0
      clock = undefined
    },
  }
}

export function watchForeignMotion(device: IndiDevice, ledger: Ledger, id: DeviceId, tolerance: number) {
  return Effect.gen(function* () {
    const subscription = yield* device.subscribe
    const detector = makeForeignMotion(tolerance)
    const track = Option.getOrUndefined(yield* device.property('TELESCOPE_TRACK_STATE'))
    if (track) detector.tracking(switchElement('TRACK_ON')(track), track.receivedAt)
    const connection = Option.getOrUndefined(yield* device.property('CONNECTION'))
    let awaitingPosition = false
    let connected = connection && switchElement('CONNECT')(connection) === true
    const initial = Option.getOrUndefined(yield* device.property('EQUATORIAL_EOD_COORD')) ?? Option.getOrUndefined(yield* device.property('EQUATORIAL_COORD'))
    if (initial && connected) detector.record({ ...positionOf(initial), at: initial.receivedAt }, true)
    return yield* Effect.forever(Effect.gen(function* () {
      const event = yield* subscription.next
      if (event.type !== 'property') { detector.reset(); return }
      const property = event.property
      if (property.name === 'CONNECTION') {
        const on = switchElement('CONNECT')(property) === true
        if (on && connected === false) awaitingPosition = true
        if (on !== connected) detector.reset()
        connected = on
        return
      }
      if (property.name === 'TELESCOPE_TRACK_STATE') {
        detector.tracking(switchElement('TRACK_ON')(property), property.receivedAt)
        return
      }
      if (!connected) return
      if (!['EQUATORIAL_EOD_COORD', 'EQUATORIAL_COORD'].includes(property.name)) return
      if (awaitingPosition && event.origin === 'def') return
      const facts = yield* Effect.orDie(ledger.facts(id))
      const explained = awaitingPosition || facts.busy || facts.quarantine.held || property.receivedAt <= (facts.recentlySettled.at(-1)?.settledAt ?? 0)
      awaitingPosition = false
      const here = { ...positionOf(property), at: property.receivedAt }
      const foreign = detector.record(here, explained)
      if (foreign) {
        yield* ledger.flagForeignMotion(id, facts.binding, foreign)
        detector.record(here, true)
      }
    }))
  })
}
