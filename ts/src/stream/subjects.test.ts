import { describe, expect, it } from 'vitest'
import { stream } from '../../testing/stream-settings.ts'
import { parseConfig } from '../rig/config.ts'
import { wireIdsOf } from '../rig/file.ts'
import { wireDeviceId, wireSubject } from './subjects.ts'

const devices = { 'ZWO AM5': 'mount', 'Pegasus PPBA': 'box' }

describe('wire subjects', () => {
  it('use the id the rig file gives the INDI device', () => {
    expect(wireDeviceId(devices, { type: 'set', indiDevice: 'ZWO AM5' })).toBe('mount')
    expect(wireDeviceId(devices, { type: 'other', tag: 'getProperties', indiDevice: 'Pegasus PPBA' })).toBe('box')
  })

  it('send a message with no device to server', () => {
    expect(wireDeviceId(devices, { type: 'other', tag: 'getProperties' })).toBe('server')
    expect(wireDeviceId(devices, { type: 'message', text: 'hello' })).toBe('server')
  })

  it('send a device not on the list to other', () => {
    expect(wireDeviceId(devices, { type: 'message', indiDevice: 'New Camera', text: 'hello' })).toBe('other')
  })

  it('name the device and direction, whatever characters the id has', () => {
    expect(wireSubject('mount', 'in')).toBe('rig-dev.wire.mount.in')
    expect(wireSubject('guide-cam', 'out')).toBe('rig-dev.wire.guide-cam.out')
  })
})

describe('the rig file\'s device names', () => {
  it('give each INDI device the id the rig file gives it', () => {
    const config = parseConfig({
      stream,
      fifo: '/run/test/indi.fifo',
      devices: [
        { id: 'mount', indiDevice: 'ZWO AM5', serial: '/dev/x', driver: 'indi_lx200am5', connected: true },
        { id: 'box', indiDevice: 'Pegasus PPBA', serial: '/dev/y', driver: 'indi_pegasus_ppba', connected: true },
      ],
    })

    expect(wireDeviceId(wireIdsOf(config), { type: 'new', indiDevice: 'Pegasus PPBA' })).toBe('box')
    expect(wireDeviceId(wireIdsOf(config), { type: 'set', indiDevice: 'ZWO AM5' })).toBe('mount')
  })
})
