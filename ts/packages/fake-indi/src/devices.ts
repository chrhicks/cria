/**
 * The generic device models: a camera the way INDI::CCD drivers define one and a
 * mount the way errai's AM5 defines one, as property definitions on a `FakeIndi`.
 * Behaviour (what a write does) is the caller's: see `Behaviour`.
 */
import { FakeIndi, type FakeVector } from './server.js'

/** A camera, the way INDI::CCD drivers define one. Exposures complete after their duration. */
export function addCamera(
  fake: FakeIndi,
  device: string,
  sensor: { width: number; height: number; widthStep?: number; maxBin?: number; mono?: boolean; upload?: 'client' | 'local' } = { width: 8, height: 6 },
): void {
  const { width, height } = sensor
  const maxBin = sensor.maxBin ?? 4

  fake.define(connection(device))
  fake.define({ device, name: 'CCD_INFO', kind: 'number', perm: 'ro', state: 'Ok', elements: { CCD_MAX_X: { value: width }, CCD_MAX_Y: { value: height }, CCD_PIXEL_SIZE_X: { value: 3.76 }, CCD_PIXEL_SIZE_Y: { value: 3.76 } } })
  fake.define({ device, name: 'CCD_BINNING', kind: 'number', perm: 'rw', state: 'Ok', elements: { HOR_BIN: { value: 1, min: 1, max: maxBin, step: 1 }, VER_BIN: { value: 1, min: 1, max: maxBin, step: 1 } } })
  fake.define({
    device,
    name: 'CCD_FRAME',
    kind: 'number',
    perm: 'rw',
    state: 'Ok',
    elements: {
      X: { value: 0, max: width - 1 },
      Y: { value: 0, max: height - 1 },
      WIDTH: { value: width, min: 1, max: width, step: sensor.widthStep ?? 0 },
      HEIGHT: { value: height, min: 1, max: height },
    },
  })
  fake.define({ device, name: 'CCD_EXPOSURE', kind: 'number', perm: 'rw', state: 'Ok', elements: { CCD_EXPOSURE_VALUE: { value: 1, min: 0.001, max: 3600, step: 1 } } })
  fake.define({ device, name: 'CCD_ABORT_EXPOSURE', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })
  fake.define({ device, name: 'CCD_FRAME_TYPE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { FRAME_LIGHT: { value: true }, FRAME_BIAS: { value: false }, FRAME_DARK: { value: false }, FRAME_FLAT: { value: false } } })
  if (!sensor.mono)
    fake.define({ device, name: 'CCD_CFA', kind: 'text', perm: 'ro', state: 'Idle', elements: { CFA_OFFSET_X: { value: '1' }, CFA_OFFSET_Y: { value: '0' }, CFA_TYPE: { value: 'RGGB' } } })
  fake.define({ device, name: 'CCD1', kind: 'blob', perm: 'ro', state: 'Idle', elements: { CCD1: { value: '' } } })
  const local = sensor.upload === 'local'

  fake.define({ device, name: 'UPLOAD_MODE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { UPLOAD_CLIENT: { value: !local }, UPLOAD_LOCAL: { value: local }, UPLOAD_BOTH: { value: false } } })
}

export function connection(device: string, connected = true): Omit<FakeVector, 'state'> & { state: FakeVector['state'] } {
  return {
    device,
    name: 'CONNECTION',
    kind: 'switch',
    perm: 'rw',
    rule: 'OneOfMany',
    state: 'Ok',
    elements: { CONNECT: { value: connected }, DISCONNECT: { value: !connected } },
  }
}

/** A mount the way errai's AM5 defines one (JNow coordinates, park, home, axis motion, labelled slew rates). */
export function addMount(fake: FakeIndi, device: string): void {
  fake.define(connection(device))
  fake.define({ device, name: 'EQUATORIAL_EOD_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { RA: { value: 2, max: 24 }, DEC: { value: 40, min: -90, max: 90 } } })
  fake.define({ device, name: 'ON_COORD_SET', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Idle', elements: { TRACK: { value: true }, SLEW: { value: false }, SYNC: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_ABORT_MOTION', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { ABORT: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_TRACK_STATE', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Idle', elements: { TRACK_ON: { value: false }, TRACK_OFF: { value: true } } })
  fake.define({ device, name: 'TELESCOPE_PARK', kind: 'switch', perm: 'rw', rule: 'OneOfMany', state: 'Ok', elements: { PARK: { value: false }, UNPARK: { value: true } } })
  fake.define({ device, name: 'TELESCOPE_HOME', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { GO: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_MOTION_WE', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { MOTION_WEST: { value: false }, MOTION_EAST: { value: false } } })
  fake.define({ device, name: 'TELESCOPE_MOTION_NS', kind: 'switch', perm: 'rw', rule: 'AtMostOne', state: 'Idle', elements: { MOTION_NORTH: { value: false }, MOTION_SOUTH: { value: false } } })
  // Named 1x..10x, labelled with the true sidereal multiples, as errai's AM5 does.
  const multiples = ['0.25x', '0.5x', '1x', '2x', '4x', '8x', '20x', '60x', '720x', '1440x']

  fake.define({
    device,
    name: 'TELESCOPE_SLEW_RATE',
    kind: 'switch',
    perm: 'rw',
    rule: 'OneOfMany',
    state: 'Idle',
    elements: Object.fromEntries(multiples.map((label, index) => [`${index + 1}x`, { value: index === 9, label }])),
  })
  fake.define({ device, name: 'GEOGRAPHIC_COORD', kind: 'number', perm: 'rw', state: 'Idle', elements: { LAT: { value: 40, min: -90, max: 90 }, LONG: { value: 285, max: 360 }, ELEV: { value: 0, min: -200, max: 10000 } } })
  // The AM5's own clock, unset, as errai showed it.
  fake.define({ device, name: 'TIME_UTC', kind: 'text', perm: 'rw', state: 'Ok', elements: { UTC: { value: '2000-01-01T00:56:31' }, OFFSET: { value: '0.00' } } })
}
