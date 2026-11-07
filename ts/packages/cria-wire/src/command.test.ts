import { Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { captureFrameTypes, commands, shutterOpen, isHalt, type DeviceFor, type HaltKind, type ParamsOf } from './index.js'

describe('command table', () => {
  it('makes exactly the stops halts', () => {
    expectTypeOf<HaltKind>().toEqualTypeOf<'mount-stop' | 'focuser-halt'>()
    expect((['mount-stop', 'focuser-halt', 'mount-slew', 'capture', 'device-connect'] as const).map(kind => isHalt({ kind }))).toEqual([true, true, false, false, false])
  })

  it('names the device kind that runs each command', () => {
    expectTypeOf<DeviceFor<'capture'>>().toEqualTypeOf<'camera'>()
    expectTypeOf<DeviceFor<'device-connect'>>().toEqualTypeOf<'any'>()
    expect([commands.capture.device, commands['switch-set'].device, commands['device-connect'].device]).toEqual(['camera', 'box', 'any'])
  })

  it('keys each row schema by its own kind', () => {
    expect(Schema.decodeUnknownSync(commands['mount-home'].schema)({ kind: 'mount-home', parameters: {} })).toEqual({ kind: 'mount-home', parameters: {} })
    expect(() => Schema.decodeUnknownSync(commands['mount-home'].schema)({ kind: 'mount-stop', parameters: {} })).toThrow()
  })

  it('derives parameter types from the wire schemas', () => {
    expectTypeOf<ParamsOf<'mount-slew'>>().toEqualTypeOf<{
      readonly rightAscensionDegrees: number
      readonly declinationDegrees: number
      readonly coordinateSystem: 'topocentric' | 'j2000'
    }>()
  })

  it('takes a capture without a frame type, and refuses one that disagrees with `light`', () => {
    const decode = Schema.decodeUnknownSync(commands.capture.schema)
    const capture = (parameters: object) => ({ kind: 'capture', parameters: { exposureSeconds: 1, ...parameters } })

    expect(decode(capture({ light: true }))).toEqual(capture({ light: true }))
    expect(captureFrameTypes.map(frameType => decode(capture({ light: shutterOpen[frameType], frameType })).parameters.frameType)).toEqual([...captureFrameTypes])
    expect(() => decode(capture({ light: false, frameType: 'flat' }))).toThrow('frameType flat needs light true')
    expect(() => decode(capture({ light: true, frameType: 'bias' }))).toThrow('frameType bias needs light false')
    expect(() => decode(capture({ light: true, frameType: 'dark-flat' }))).toThrow()
  })
})
