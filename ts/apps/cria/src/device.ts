/** Composition: what a configured device is made of. */
import type { DeviceKind } from '@cria/wire'
import { makeCamera, type Camera } from './capability/camera.js'
import { makeConnection, type Connection } from './capability/connection.js'
import type { CapabilityContext } from './capability/context.js'
import { makeFocuser, type Focuser } from './capability/focuser.js'
import { makeMount, type Mount } from './capability/mount.js'
import { makePower, type Power } from './capability/power.js'
import type { DeviceSetup } from './capability/setup.js'
import { makeWeather, type Weather } from './capability/weather.js'
import { mountMotionDefaults, type DeviceConfig } from './config.js'

export interface CapabilityOf {
  readonly camera: Camera
  readonly mount: Mount
  readonly focuser: Focuser
  readonly weather: Weather
  readonly switch: Power
}

export interface Equipment {
  readonly capability: CapabilityOf[DeviceKind]
  readonly connection: Connection
}

const makers: { readonly [D in DeviceKind]: (context: CapabilityContext, device: DeviceConfig, setup: DeviceSetup) => CapabilityOf[D] } = {
  camera: (context, device) => makeCamera(context, device.frameGrid),
  mount: (context, device, setup) => makeMount(context, { ...mountMotionDefaults, ...device.motion }, setup),
  focuser: (context, device) => makeFocuser(context, device.travel),
  weather: makeWeather,
  switch: (context, device) => makePower(context, device.channels ?? []),
}

export function equip(device: DeviceConfig, context: CapabilityContext, connectTimeoutMs: number, setup: DeviceSetup): Equipment {
  return { capability: makers[device.kind](context, device, setup), connection: makeConnection(context, connectTimeoutMs, setup, device.port) }
}
