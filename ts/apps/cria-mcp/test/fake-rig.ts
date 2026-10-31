import { type Behaviour, type FakeIndi } from '@cria/fake-indi'
import { fitsFrame } from '@cria/fits'

/** A camera that finishes an exposure after its duration and sends a frame. */
export const exposesAndSendsFrame: Behaviour = (fake, vector, values) => {
  if (vector.name !== 'CCD_EXPOSURE') return 'default'
  const seconds = Number(values.CCD_EXPOSURE_VALUE)
  const startedAt = Date.now()

  fake.update(vector.device, vector.name, { state: 'Busy', values: { CCD_EXPOSURE_VALUE: seconds } })
  setTimeout(() => {
    if (fake.vector(vector.device, 'CCD_EXPOSURE').state !== 'Busy') return
    fake.sendBlob(vector.device, 'CCD1', 'CCD1', fitsFrame(8, 6, { exptime: seconds, startedAt }))
    fake.update(vector.device, 'CCD_EXPOSURE', { state: 'Ok', values: { CCD_EXPOSURE_VALUE: 0 } })
  }, seconds * 1000).unref()

  return 'handled'
}

const siderealDegreesPerSecond = 15.041067 / 3600
const publishEveryMs = 100

/**
 * A mount that moves on its east-west axis at the selected slew rate (its label is a multiple of the sidereal rate),
 * publishing its right ascension as it goes, and stops at once when the motion is cleared or aborted.
 */
export const movesOnAxis = (fake: FakeIndi, device: string): Behaviour => {
  let degreesPerSecond = 0
  const coordinates = () => fake.vector(device, 'EQUATORIAL_EOD_COORD').elements.RA!
  const ticker = setInterval(() => {
    if (degreesPerSecond !== 0) fake.update(device, 'EQUATORIAL_EOD_COORD', { values: { RA: Number(coordinates().value) + (degreesPerSecond * publishEveryMs) / 1000 / 15 } })
  }, publishEveryMs)

  ticker.unref()
  fake.onStop(() => clearInterval(ticker))

  const halt = () => {
    degreesPerSecond = 0
    fake.update(device, 'TELESCOPE_MOTION_WE', { state: 'Idle', values: { MOTION_EAST: false, MOTION_WEST: false } })
  }

  return (fake, vector, values) => {
    if (vector.device !== device) return 'default'

    if (vector.name === 'TELESCOPE_MOTION_WE') {
      const direction = values.MOTION_EAST === 'On' ? 1 : values.MOTION_WEST === 'On' ? -1 : 0

      if (direction === 0) halt()
      else {
        const selected = Object.values(fake.vector(device, 'TELESCOPE_SLEW_RATE').elements).find(element => element.value === true)

        degreesPerSecond = direction * Number.parseFloat(selected?.label ?? '1x') * siderealDegreesPerSecond
        fake.apply(vector, values)
        fake.update(device, vector.name, { state: 'Busy' })
      }

      return 'handled'
    }

    if (vector.name === 'TELESCOPE_ABORT_MOTION') {
      halt()
      fake.update(device, vector.name, { state: 'Ok' })

      return 'handled'
    }

    return 'default'
  }
}
