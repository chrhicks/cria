import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import { DeviceId, deviceKinds } from './wire.ts'

const Name = Schema.String.pipe(Schema.check(Schema.isBetweenLength(1, 256)))
const Port = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65535 })))
const Milliseconds = (minimum: number, maximum: number) =>
  Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum, maximum })))
const Between = (minimum: number, maximum: number) => Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum, maximum })))

const Site = Schema.Struct({
  latitudeDegrees: Between(-90, 90),
  longitudeDegrees: Between(-180, 180),
  elevationMeters: Between(-500, 9000),
}).annotate({ description: 'Where the mount stands, written to GEOGRAPHIC_COORD when it connects. Longitude is east positive.' })

const Device = Schema.Struct({
  id: DeviceId,
  kind: Schema.Literals(deviceKinds),
  indiDevice: Name.annotate({ description: 'The INDI device name.' }),
  port: Schema.optionalKey(Name.annotate({ description: 'Written to DEVICE_PORT before connecting, for serial devices.' })),
  site: Schema.optionalKey(Site),
  driverDebug: Schema.optionalKey(Schema.Boolean.annotate({ description: 'Turn the driver debug switches on after connecting.' })),
})

export const ConfigSchema = Schema.Struct({
  listen: Schema.Struct({ host: Schema.String, port: Port }),
  indi: Schema.Struct({ host: Schema.String, port: Port }),
  confirmMs: Milliseconds(1000, 120_000).annotate({
    description: 'How long a driver has, after a setup write, to show the value applied.',
  }),
  definitionWaitMs: Milliseconds(0, 60_000).annotate({
    description: 'How long setup waits for a property the driver has not defined yet. INDI drivers define their device properties only after CONNECTION goes Ok, so right after a connect they arrive a moment later.',
  }),
  connectTimeoutMs: Milliseconds(1000, 300_000).annotate({ description: 'How long a cold device may take to connect (Pegasus took 40-82 s on Windows).' }),
  streamClientConfig: Schema.optionalKey(Schema.String.annotate({ description: 'The rig stream client settings file. Absent, Cria does not publish.' })),
  devices: Schema.Array(Device).pipe(Schema.check(Schema.isBetweenLength(1, 16))),
})

type Decoded = typeof ConfigSchema.Type

export type DeviceConfig = Decoded['devices'][number]
export type Config = Omit<Decoded, 'devices'> & { readonly devices: ReadonlyArray<DeviceConfig> }

export const defaults = {
  listen: { host: '127.0.0.1', port: 4319 },
  indi: { host: '127.0.0.1', port: 7624 },
  confirmMs: 15_000,
  definitionWaitMs: 5_000,
  connectTimeoutMs: 120_000,
}

export function decodeConfig(input: unknown): Config {
  const withDefaults = typeof input === 'object' && input !== null ? { ...defaults, ...input } : input
  const config = Schema.decodeUnknownSync(ConfigSchema)(withDefaults, { onExcessProperty: 'error' })

  if (new Set(config.devices.map(device => device.id)).size !== config.devices.length) throw new Error('Device ids must be unique')
  for (const device of config.devices) {
    if (device.kind !== 'mount' && device.site !== undefined) throw new Error(`${device.id}: site applies to a mount only`)
  }

  return config
}

export function loadConfig(path: string): Config {
  return decodeConfig(JSON.parse(readFileSync(path, 'utf8')))
}
