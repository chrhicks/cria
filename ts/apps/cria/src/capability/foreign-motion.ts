import { Effect, Option } from 'effect'
import type { IndiDevice } from '@cria/indi'
import type { DeviceId, ForeignMotion } from '@cria/wire'
import type { Ledger } from '../operation/ledger.js'
import { switchElement } from './fields.js'
import { angularDelta, positionOf, type Reading } from './stopped.js'

const siderealDegreesPerMs = 360 / 86_164_090.5
const axes = (ra: number, dec: number) => ({ rightAscensionDegrees: ra, declinationDegrees: dec })

// The default tolerance is 0.02° (72 arcsec) over any 10 s. Guiding at 0.5–0.9x sidereal
// is 7.5–13.5 arcsec/s for <2 s per alternating pulse (<27 arcsec), with dithers of tens
// of arcsec. A 1x hand controller moves 15 arcsec/s and crosses 72 arcsec in 4.8 s.
const motionWindowMs = 10_000
// 0.5° is 30 arcmin. A whole night of guide corrections for a few arcmin of polar error
// stays under 15 arcmin, while this bound still catches slow runaway below the rate threshold.
const creepDegrees = 0.5

type Sample = { readonly reading: Reading; readonly residualRa: number }

export function makeForeignMotion(tolerance: number) {
  let previous: Reading | undefined
  let anchor: Reading | undefined
  let samples: Sample[] = []
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
        samples = []
      } else {
        residualRa += angularDelta(here.ra, previous.ra) - drift
      }
      drift = 0
      previous = here
      const dec = here.dec - anchor.dec
      samples = samples.filter(sample => sample.reading.at >= here.at - motionWindowMs)
      const recent = samples.find(sample => Math.abs(residualRa - sample.residualRa) > tolerance || Math.abs(here.dec - sample.reading.dec) > tolerance)
      samples.push({ reading: here, residualRa })
      if (recent) return { at: here.at, from: axes(recent.reading.ra, recent.reading.dec), to: axes(here.ra, here.dec),
        unexplained: axes(residualRa - recent.residualRa, here.dec - recent.reading.dec) }
      if (Math.abs(residualRa) <= creepDegrees && Math.abs(dec) <= creepDegrees) return
      return { at: here.at, from: axes(anchor.ra, anchor.dec), to: axes(here.ra, here.dec), unexplained: axes(residualRa, dec) }
    },
    reset() {
      previous = undefined
      anchor = undefined
      samples = []
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
