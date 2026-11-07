/**
 * Composition: configuration. One Effect Schema (a View: it gives the type and
 * the validator) decoded once at start; an invalid file stops the process.
 */
import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import { DeviceId, deviceKinds } from '@cria/wire'

const Name = Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 256)))
// Port 0 asks the system for any free port (tests).
const Port = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65535 })))
const Milliseconds = (minimum: number, maximum: number) =>
  Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum, maximum })))

const SwitchChannel = Schema.Struct({
  name: Name,
  property: Name,
  element: Name,
  /** The name of the switch channel under which the driver sets this one by itself (auto dew over a dew duty). */
  automaticWhileOn: Schema.optionalKey(Name),
})

const Between = (minimum: number, maximum: number) => Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum, maximum })))

/** Where the mount stands. Cria writes it to the mount after it connects (capability/setup.ts). */
const Site = Schema.Struct({
  latitudeDegrees: Between(-90, 90),
  /** East positive, as the wire reports it; INDI's 0-360 east is Cria's to convert. */
  longitudeDegrees: Between(-180, 180),
  elevationMeters: Between(-500, 9000),
})

/** How a mount stops, measured on errai's AM5 (docs/ts/SPEC.md, "Stopping the mount"). */
const MountMotion = Schema.Struct({
  /** Readings of the position that differ by at most this on each axis, across a window, mean the mount stands still. */
  stationaryDegrees: Schema.optionalKey(Between(0.001, 1)),
  /** The spacing of those reads, and the window they must span: longer than the driver's poll of the mount (1 s on the AM5). */
  positionReadMs: Schema.optionalKey(Milliseconds(250, 10_000)),
  /** Coast seed in milliseconds for rates without a measured profile. */
  stopLatencyMs: Schema.optionalKey(Milliseconds(0, 10_000)),
})

export type MountMotionSettings = Required<typeof MountMotion.Type>

const Steps = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 2_147_483_646 })))

/** The focuser positions that are safe for the hardware, both ends included (capability/focuser.ts). */
const FocuserTravel = Schema.Struct({ min: Steps, max: Steps })

export type FocuserTravel = typeof FocuserTravel.Type

const Device = Schema.Struct({
  id: DeviceId,
  kind: Schema.Literals(deviceKinds),
  /** The INDI device name, which is also the name Vela expects. */
  indiDevice: Name,
  /** Written to DEVICE_PORT before connecting, for serial devices. */
  port: Schema.optionalKey(Name),
  channels: Schema.optionalKey(Schema.Array(SwitchChannel).pipe(Schema.check(Schema.isMaxLength(64)))),
  site: Schema.optionalKey(Site),
  driverDebug: Schema.optionalKey(Schema.Boolean),
  motion: Schema.optionalKey(MountMotion),
  travel: Schema.optionalKey(FocuserTravel),
})

/** Record Cria's INDI traffic into `dir` (docs/ts/SPEC.md, "Recording"). Absent means off. */
const Record = Schema.Struct({
  dir: Name,
  /** Recording stops for good when it would leave less than this free on the disk, in GiB. */
  reserveGb: Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }))),
  /** The most memory a stalled disk can make recording hold before it stops, in MiB. One image can be 52 MB. */
  queueMb: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65_536 }))),
})

export const ConfigSchema = Schema.Struct({
  listen: Schema.Struct({ host: Schema.String, port: Port }),
  indi: Schema.Struct({ host: Schema.String, port: Port }),
  imageDirectory: Schema.String,
  imageBudgetBytes: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
  commandsEnabled: Schema.Boolean,
  /** How long a driver has to acknowledge a command before it is uncertain. */
  acknowledgeMs: Milliseconds(500, 60_000),
  /** How long a driver has, after answering, to show a setting applied or a device at rest; a stop gets this plus acknowledgeMs. errai's AM5 read at rest 7.7 s after a stop at 3°/s (2026-11-06), and a camera abort took 0.8 s. */
  confirmMs: Milliseconds(1000, 120_000),
  /** Overrun allowance for a motion. */
  operationTimeoutMs: Milliseconds(1000, 600_000),
  /** How long a cold device may take to connect (Pegasus took 40-82 s on Windows). */
  connectTimeoutMs: Milliseconds(1000, 300_000),
  operationHistory: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 10, maximum: 100_000 }))),
  record: Schema.optionalKey(Record),
  streamClientConfig: Schema.optionalKey(Schema.String),
  devices: Schema.Array(Device).pipe(Schema.check(Schema.isBetweenLength(1, 16))),
})

type Decoded = typeof ConfigSchema.Type

export type DeviceConfig = Decoded['devices'][number]
export type Config = Omit<Decoded, 'devices'> & { readonly devices: ReadonlyArray<DeviceConfig> }

export const defaults = {
  listen: { host: '127.0.0.1', port: 4319 },
  indi: { host: '127.0.0.1', port: 7624 },
  imageBudgetBytes: 1024 ** 3,
  commandsEnabled: true,
  acknowledgeMs: 5000,
  confirmMs: 15_000,
  operationTimeoutMs: 180_000,
  connectTimeoutMs: 120_000,
  operationHistory: 1000,
}

export const mountMotionDefaults: MountMotionSettings = {
  stationaryDegrees: 0.02,
  positionReadMs: 1500,
  stopLatencyMs: 900,
}

export function decodeConfig(input: unknown): Config {
  const withDefaults = typeof input === 'object' && input !== null ? { ...defaults, ...input } : input
  const config = Schema.decodeUnknownSync(ConfigSchema)(withDefaults, { onExcessProperty: 'error' })
  const ids = new Set(config.devices.map(device => device.id))

  if (ids.size !== config.devices.length) throw new Error('Device ids must be unique')
  for (const device of config.devices) {
    if (device.kind !== 'mount' && (device.site !== undefined || device.motion !== undefined))
      throw new Error(`${device.id}: site and motion apply to a mount only`)
    if (device.travel !== undefined && device.kind !== 'focuser') throw new Error(`${device.id}: travel applies to a focuser only`)
    if (device.travel !== undefined && device.travel.min >= device.travel.max) throw new Error(`${device.id}: travel min must be below max`)
    for (const channel of device.channels ?? []) {
      if (channel.automaticWhileOn !== undefined && !device.channels?.some(other => other !== channel && other.name === channel.automaticWhileOn))
        throw new Error(`Channel ${channel.name} of ${device.id}: automaticWhileOn names no other channel`)
    }
  }

  return config
}

export function loadConfig(path: string): Config {
  return decodeConfig(JSON.parse(readFileSync(path, 'utf8')))
}

