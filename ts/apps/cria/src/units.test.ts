import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { shiftPattern } from './capability/camera.js'
import { localSiderealHours } from './capability/mount.js'
import { decodeConfig } from './config.js'
import { CommandSchema } from '@cria/wire'

function refusal(input: unknown): string {
  const decoded = Schema.decodeUnknownResult(CommandSchema)(input, { onExcessProperty: 'error' })

  return Result.isFailure(decoded) ? decoded.failure.message : 'accepted'
}

describe('operation parameters (protocol 4 bounds)', () => {
  it('accepts a valid capture and refuses unknown keys', () => {
    expect(refusal({ kind: 'capture', parameters: { exposureSeconds: 2, light: true } })).toBe('accepted')
    expect(refusal({ kind: 'capture', parameters: { exposureSeconds: 2, light: true, gain: 100 } })).toBe('Expected no excess property\n  at ["parameters"]["gain"]')
  })

  it('refuses a focuser target outside its travel window, a zero axis rate and an empty camera setting', () => {
    expect(refusal({ kind: 'focuser-move', parameters: { position: 10, minPosition: 20, maxPosition: 30 } })).toBe(
      'Target is outside the requested focuser travel window\n  at ["parameters"]',
    )
    expect(refusal({ kind: 'mount-axis', parameters: { rateDegreesPerSecond: 0, durationSeconds: 1 } })).toBe('must not be zero\n  at ["parameters"]["rateDegreesPerSecond"]')
    expect(refusal({ kind: 'camera-configure', parameters: {} })).toBe('at least one setting is required\n  at ["parameters"]')
  })
})

describe('configuration', () => {
  const config = (indiDevice: string) =>
    decodeConfig({ listen: { host: '127.0.0.1', port: 0 }, indi: { host: '127.0.0.1', port: 7624 }, imageDirectory: '/tmp/cria', devices: [{ id: 'power', kind: 'switch', indiDevice, channels: [{ name: 'Port 1', property: 'P', element: 'E' }] }] })

  it('names the failure domain after the INDI device, and refuses a name with nothing to slug', () => {
    expect(config('Pegasus PPBA').devices[0]!.failureDomain).toBe('pegasus-ppba')
    expect(() => config('***')).toThrow('INDI device "***" has no letters or digits to name its failure domain')
  })

  it('refuses a channel set automatically under a channel that is not configured', () => {
    const power = (automaticWhileOn: string) =>
      decodeConfig({
        listen: { host: '127.0.0.1', port: 0 },
        indi: { host: '127.0.0.1', port: 7624 },
        imageDirectory: '/tmp/cria',
        devices: [
          {
            id: 'power',
            kind: 'switch',
            indiDevice: 'Pegasus PPBA',
            channels: [
              { name: 'Dew A duty (%)', property: 'DEW_DUTY_CYCLES', element: 'DEW_CHANNEL_1', automaticWhileOn },
              { name: 'Auto dew', property: 'AUTO_DEW_CONTROL', element: 'DEW_CHANNEL_1' },
            ],
          },
        ],
      })

    expect(power('Auto dew').devices[0]!.channels![0]!.automaticWhileOn).toBe('Auto dew')
    expect(() => power('Auto Dew')).toThrow('Channel Dew A duty (%) of power: automaticWhileOn names no other channel')
  })

  it("checks a mount's site ranges and refuses a site on a device that is not a mount", () => {
    const withSite = (kind: string, site: object) =>
      decodeConfig({ listen: { host: '127.0.0.1', port: 0 }, indi: { host: '127.0.0.1', port: 7624 }, imageDirectory: '/tmp/cria', devices: [{ id: 'mount', kind, indiDevice: 'ZWO AM5', site }] })
    const site = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

    expect(withSite('mount', site).devices[0]!.site).toEqual(site)
    expect(() => withSite('mount', { ...site, longitudeDegrees: 247.93 })).toThrow('Expected a value between -180 and 180\n  at ["devices"][0]["site"]["longitudeDegrees"]')
    expect(() => withSite('mount', { ...site, latitudeDegrees: 91 })).toThrow('Expected a value between -90 and 90\n  at ["devices"][0]["site"]["latitudeDegrees"]')
    expect(() => withSite('camera', site)).toThrow('mount: site and motion apply to a mount only')
  })

  it("checks a focuser's travel window and refuses one on a device that is not a focuser", () => {
    const withTravel = (kind: string, travel: object) =>
      decodeConfig({ listen: { host: '127.0.0.1', port: 0 }, indi: { host: '127.0.0.1', port: 7624 }, imageDirectory: '/tmp/cria', devices: [{ id: 'focuser', kind, indiDevice: 'ZWO EAF', travel }] })

    expect(withTravel('focuser', { min: 15500, max: 38000 }).devices[0]!.travel).toEqual({ min: 15500, max: 38000 })
    expect(() => withTravel('focuser', { min: 15500.5, max: 38000 })).toThrow('Expected an integer\n  at ["devices"][0]["travel"]["min"]')
    expect(() => withTravel('focuser', { min: -1, max: 38000 })).toThrow('Expected a value between 0 and 2147483646\n  at ["devices"][0]["travel"]["min"]')
    expect(() => withTravel('focuser', { min: 0, max: 2_147_483_647 })).toThrow('Expected a value between 0 and 2147483646\n  at ["devices"][0]["travel"]["max"]')
    expect(() => withTravel('focuser', { min: 38000, max: 38000 })).toThrow('focuser: travel min must be below max')
    expect(() => withTravel('camera', { min: 15500, max: 38000 })).toThrow('focuser: travel applies to a focuser only')
  })
})

describe('INDI to ASCOM conventions', () => {
  it('shifts a Bayer pattern by the subframe origin', () => {
    expect(shiftPattern('rggb', 1, 0)).toBe('grbg')
    expect(shiftPattern('rggb', 0, 1)).toBe('gbrg')
    expect(shiftPattern('rggb', 3, 5)).toBe('bggr')
  })

  it('computes local sidereal time (GMST at J2000.0 is 18.697 h)', () => {
    expect(localSiderealHours(Date.parse('2000-01-01T12:00:00Z'), 0)).toBeCloseTo(18.697374558, 6)
    expect(localSiderealHours(Date.parse('2000-01-01T12:00:00Z'), -112.07)).toBeCloseTo(11.226041225, 6)
  })
})
