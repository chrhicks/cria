import { describe, expect, it } from 'vitest'
import { decodeConfig } from './config.ts'

const device = { id: 'primary', kind: 'camera', indiDevice: 'Fake CCD' }

describe('config', () => {
  it('fills in the defaults', () => {
    expect(decodeConfig({ devices: [device] })).toMatchObject({ listen: { port: 4319 }, indi: { port: 7624 }, confirmMs: 15_000, connectTimeoutMs: 120_000 })
  })

  it('refuses a key it does not know, at the top and on a device', () => {
    expect(() => decodeConfig({ devices: [device], commandsEnabled: true })).toThrow(/commandsEnabled/)
    expect(() => decodeConfig({ devices: [{ ...device, travel: { min: 1, max: 2 } }] })).toThrow(/travel/)
  })

  it('refuses duplicate device ids and a site on anything but a mount', () => {
    expect(() => decodeConfig({ devices: [device, device] })).toThrow('Device ids must be unique')
    expect(() => decodeConfig({ devices: [{ ...device, site: { latitudeDegrees: 1, longitudeDegrees: 1, elevationMeters: 1 } }] })).toThrow('site applies to a mount only')
  })
})
