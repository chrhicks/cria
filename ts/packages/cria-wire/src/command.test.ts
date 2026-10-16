import { Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { SwitchChannel, commands, isHalt, type DeviceBody, type DeviceFor, type HaltKind, type ParamsOf, type ReadingsOf } from './index.js'

describe('command table', () => {
  it('makes exactly the stops halts', () => {
    expectTypeOf<HaltKind>().toEqualTypeOf<'mount-stop' | 'focuser-halt'>()
    expect((['mount-stop', 'focuser-halt', 'mount-slew', 'capture', 'device-connect'] as const).map(kind => isHalt({ kind }))).toEqual([true, true, false, false, false])
  })

  it('names the device kind that runs each command', () => {
    expectTypeOf<DeviceFor<'capture'>>().toEqualTypeOf<'camera'>()
    expectTypeOf<DeviceFor<'device-connect'>>().toEqualTypeOf<'any'>()
    expect([commands.capture.device, commands['switch-set'].device, commands['device-connect'].device]).toEqual(['camera', 'switch', 'any'])
  })

  it('keys each row schema by its own kind', () => {
    expect(Schema.decodeUnknownSync(commands['mount-park'].schema)({ kind: 'mount-park', parameters: {} })).toEqual({ kind: 'mount-park', parameters: {} })
    expect(() => Schema.decodeUnknownSync(commands['mount-park'].schema)({ kind: 'mount-stop', parameters: {} })).toThrow()
  })

  it('derives parameter and device body types from the wire schemas', () => {
    expectTypeOf<ParamsOf<'mount-slew'>>().toEqualTypeOf<{
      readonly rightAscensionDegrees: number
      readonly declinationDegrees: number
      readonly coordinateSystem: 'topocentric' | 'j2000'
    }>()
    expectTypeOf<DeviceBody<'switch'>>().toEqualTypeOf<{
      readonly kind: 'switch'
      readonly readings: ReadingsOf<'switch'>
      readonly channels: ReadonlyArray<typeof SwitchChannel.Type>
    }>()
  })
})
