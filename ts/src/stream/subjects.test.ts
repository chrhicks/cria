import { describe, expect, it } from 'vitest'
import { defaultWireDevices, wireDevice, wireSubject } from './subjects.ts'

const devices = { 'ZWO AM5': 'mount', 'Pegasus PPBA': 'box' }

describe('wire subjects', () => {
  it('use the short id of the device in the first tag', () => {
    expect(wireSubject(devices, 'in', '<setNumberVector device="ZWO AM5" name="EQUATORIAL_EOD_COORD">')).toBe('rig-dev.wire.mount.in')
    expect(wireSubject(devices, 'out', '\n  <getProperties version="1.7" device="Pegasus PPBA"/>')).toBe('rig-dev.wire.box.out')
  })

  it('send a message with no device to server', () => {
    expect(wireSubject(devices, 'out', '<getProperties version="1.7"/>')).toBe('rig-dev.wire.server.out')
    expect(wireSubject(devices, 'in', '<message timestamp="2026-11-06T18:00:00" message="hello"/>')).toBe('rig-dev.wire.server.in')
    expect(wireSubject(devices, 'in', '<defNumberVector device="" name=""/>')).toBe('rig-dev.wire.server.in')
  })

  it('send a device not on the list to other', () => {
    expect(wireSubject(devices, 'in', '<message device="New Camera" message="hello"/>')).toBe('rig-dev.wire.other.in')
  })

  it('does not read a device from a later element', () => {
    expect(wireSubject(devices, 'in', '<message message="hello"/><setNumberVector device="ZWO AM5"/>')).toBe('rig-dev.wire.server.in')
  })
})

describe('the rig\'s device names', () => {
  it('give one id to the power box, which Cria splits into two views', () => {
    expect(wireDevice(defaultWireDevices, '<newSwitchVector device="Pegasus PPBA" name="X">')).toBe('box')
  })
})
