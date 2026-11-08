import { join } from 'node:path'
import { Schema } from 'effect'
import { decodeConfig, described } from '../config.ts'
import { StreamSettings } from '../stream/config.ts'

export const nowToken = { value: 'now', description: 'In onConnect, a text value of "now" is written as the current UTC time, YYYY-MM-DDTHH:MM:SS, the form TIME_UTC takes on the wire' } as const

export const refusedProperties = {
  value: [
    'EQUATORIAL_EOD_COORD',
    'EQUATORIAL_COORD',
    'HORIZONTAL_COORD',
    'TARGET_EOD_COORD',
    'TELESCOPE_MOTION_NS',
    'TELESCOPE_MOTION_WE',
    'TELESCOPE_TIMED_GUIDE_NS',
    'TELESCOPE_TIMED_GUIDE_WE',
    'TELESCOPE_PARK',
    'TELESCOPE_HOME',
    'TELESCOPE_TRACK_STATE',
    'ABS_FOCUS_POSITION',
    'REL_FOCUS_POSITION',
    'FOCUS_MOTION',
    'Goto',
    'ABS_ROTATOR_ANGLE',
    'ROTATOR_HOME',
    'FILTER_SLOT',
    'DOME_MOTION',
    'DOME_GOTO',
    'DOME_PARK',
    'ABS_DOME_POSITION',
    'REL_DOME_POSITION',
    'DOME_SHUTTER',
    'CCD_EXPOSURE',
    'GUIDER_EXPOSURE',
    'CCD_FAST_COUNT',
    'CCD_VIDEO_STREAM',
    'RECORD_STREAM',
  ],
  description:
    "Properties the rig program refuses in the rig file because writing one starts a motion or an exposure (AGENTS.md). Source: the Telescope, CCD, Guider, Focuser, Filter Wheel, Rotator and Dome sections of the INDI standard properties document (libindi 2.x's indistandardproperty.h lists only general and connection properties, so it adds none), plus the starters errai's drivers define on top of those, read with indi_getprop on 2026-11-07 from the ZWO AM5, ASI2600MC Pro, ASI220MM Mini, EAF and Pegasus PPBA: Goto (EAF presets), CCD_FAST_COUNT, CCD_VIDEO_STREAM, RECORD_STREAM. Aborts are not listed: they stop a motion or an exposure and never start one.",
} as const


const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0))

export const WantedValue = Schema.Union([Schema.Finite, Schema.Boolean, Schema.String])

export type WantedValue = typeof WantedValue.Type

const refused = (properties: Readonly<Record<string, unknown>>) => Object.keys(properties).find(name => (refusedProperties.value as ReadonlyArray<string>).includes(name))

const Elements = Schema.Record(Schema.String, WantedValue).check(Schema.makeFilter(elements => Object.keys(elements).length > 0 || 'must name at least one element'))

const WantedProperties = Schema.Record(Schema.String, Elements).check(
  Schema.makeFilter(properties => {
    const name = refused(properties)

    return name === undefined || `${name} starts a motion or an exposure, which the rig program never writes`
  }),
)

const Device = Schema.Struct({
  id: Schema.NonEmptyString,
  indiDevice: Schema.NonEmptyString,
  usb: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$/, { expected: 'a vendor:product pair like 03c3:260a' }))),
  serial: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\//, { expected: 'an absolute path' }))),
  driver: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+$/, { expected: 'an executable name' })),
  connected: Schema.Boolean,
  properties: described('Properties the device should hold', WantedProperties, {}),
  onConnect: described('Properties written once each time the device becomes connected', WantedProperties, {}),
}).check(
  Schema.makeFilter(device => {
    if ((device.usb === undefined) === (device.serial === undefined)) return `device ${device.id}: give exactly one of usb and serial`

    return device.serial === undefined || !('DEVICE_PORT' in device.properties) || `device ${device.id}: DEVICE_PORT comes from serial`
  }),
)

export const RigFile = Schema.Struct({
  indiHost: described('Where indiserver listens: the rig program works on errai, next to indiserver, so bring-up never depends on thuban or the broker', Schema.NonEmptyString, '127.0.0.1'),
  indiPort: described('indiserver port', positiveInteger, 7624),
  fifo: Schema.optionalKey(Schema.NonEmptyString.annotate({ description: "The FIFO indiserver reads driver commands from. Default: indi.fifo in XDG_RUNTIME_DIR, where indiserver.service makes it" })),
  pollMs: described('How often the rig program compares INDI with this file', positiveInteger, 5_000),
  settlePolls: described('Polls in a row a device must look the same before the rig program acts on it: a USB device can show in sysfs before it can be opened, and a restarted driver takes a moment to define its devices', positiveInteger, 2),
  fifoGapMs: described('Between any two lines written to the FIFO, so indiserver has dropped a stopped driver before the next start. The rig program holds the FIFO open for its whole life, so indiserver never sees a writer close; before that, on errai 2026-11-07 17:07 ET, a start written right after another line opened while indiserver had the FIFO closed and failed with ENXIO', Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 1_000),
  backoffMs: described('Wait before the next try after the 1st, 2nd and later failure, for a write that did not take and for a driver restart', Schema.Array(positiveInteger).check(Schema.isMinLength(1, { expected: 'at least one wait' })), [10_000, 30_000, 60_000]),
  minRestartGapMs: described('One driver is restarted at most once in this long, whatever the backoff says', positiveInteger, 20_000),
  numberTolerance: described('How far a number INDI shows may be from the wanted one and still count as set: GEOGRAPHIC_COORD came back from the AM5 within 2.2e-7 of what was written in all 31 recordings from 2026-11-03 to 11-07 (0 in 30 of them), so this only absorbs the text round trip', Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), 1e-6),
  deadLinkMs: described('How long a serial device\'s driver must report errors without a break before the link counts as dead. The longest burst that was not a dead link lasted 10.0 s (a power-off, 2026-10-24 02:28 ET; five bursts from 2 to 10 s between 10-23 and 10-31); the shortest dead link lasted 77 s (2026-11-02 21:22:50 ET)', positiveInteger, 30_000),
  errorGapMs: described('The longest silence between two driver errors that still belongs to one burst. Inside every dead link on 11-01 and 11-02 the errors came at least every 2.0 s (box) and 1.6 s (mount); the rig program also looks only every poll', positiveInteger, 5_000),
  reconnectWaitMs: described('How long after a reconnect the device may stay disconnected or keep reporting errors before its driver is restarted. The AM5 and the PPBA each connected in 10 s on 2026-11-01 (wire); the Pegasus once took 40 to 82 s on Windows', positiveInteger, 60_000),
  devices: Schema.Array(Device).check(
    Schema.isMinLength(1, { expected: 'at least one device' }),
    Schema.makeFilter(devices => {
      const repeated = devices.find((device, index) => devices.findIndex(other => other.id === device.id) !== index)

      return repeated === undefined || `device ${repeated.id} is listed twice`
    }),
  ),
  stream: StreamSettings,
})

type WantedProperties = Readonly<Record<string, Readonly<Record<string, WantedValue>>>>

export interface RigDevice {
  readonly id: string
  readonly indiDevice: string
  readonly usb?: string
  readonly serial?: string
  readonly driver: string
  readonly connected: boolean
  readonly properties: WantedProperties
  readonly onConnect: WantedProperties
}

export type RigConfig = Omit<typeof RigFile.Type, 'fifo' | 'devices'> & {
  readonly fifo: string
  readonly devices: ReadonlyArray<RigDevice>
}

const normalised = (device: (typeof RigFile.Type)['devices'][number]): RigDevice => ({
  id: device.id,
  indiDevice: device.indiDevice,
  ...(device.usb !== undefined && { usb: device.usb.toLowerCase() }),
  ...(device.serial !== undefined && { serial: device.serial }),
  driver: device.driver,
  connected: device.connected,
  properties: device.serial === undefined ? device.properties : { DEVICE_PORT: { PORT: device.serial }, ...device.properties },
  onConnect: device.onConnect,
})

export function parseConfig(json: unknown, environment: { readonly runtimeDir?: string | undefined } = {}): RigConfig {
  const file = decodeConfig(RigFile, json)
  const fifo = file.fifo ?? (environment.runtimeDir ? join(environment.runtimeDir, 'indi.fifo') : undefined)

  if (fifo === undefined) throw new Error('fifo is required when XDG_RUNTIME_DIR is not set')

  return { ...file, fifo, devices: file.devices.map(normalised) }
}
