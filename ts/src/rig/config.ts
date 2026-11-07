import { join } from 'node:path'

export const settings = {
  indiHost: { value: '127.0.0.1', description: 'Where indiserver listens: the rig program works on errai, next to indiserver, so bring-up never depends on thuban or the broker' },
  indiPort: { value: 7624, description: 'indiserver port' },
  pollMs: { value: 5_000, description: 'How often the rig program compares INDI with this file' },
  settlePolls: { value: 2, description: 'Polls in a row a device must look the same before the rig program acts on it: a USB device can show in sysfs before it can be opened, and a restarted driver takes a moment to define its devices' },
  stopGapMs: { value: 1_000, description: 'Between stop and start on the FIFO, so indiserver has dropped the old process' },
  backoffMs: { value: [10_000, 30_000, 60_000], description: 'Wait before the next try after the 1st, 2nd and later failure, for a write that did not take and for a driver restart' },
  minRestartGapMs: { value: 20_000, description: 'One driver is restarted at most once in this long, whatever the backoff says' },
  numberTolerance: { value: 1e-6, description: 'How far a number INDI shows may be from the wanted one and still count as set: GEOGRAPHIC_COORD came back from the AM5 within 2.2e-7 of what was written in all 31 recordings from 2026-11-03 to 11-07 (0 in 30 of them), so this only absorbs the text round trip' },
  deadLinkMs: { value: 30_000, description: 'How long a serial device\'s driver must report errors without a break before the link counts as dead. The longest burst that was not a dead link lasted 10.0 s (a power-off, 2026-10-24 02:28 ET; five bursts from 2 to 10 s between 10-23 and 10-31); the shortest dead link lasted 77 s (2026-11-02 21:22:50 ET)' },
  errorGapMs: { value: 5_000, description: 'The longest silence between two driver errors that still belongs to one burst. Inside every dead link on 11-01 and 11-02 the errors came at least every 2.0 s (box) and 1.6 s (mount); the rig program also looks only every poll' },
  reconnectWaitMs: { value: 60_000, description: 'How long after a reconnect the device may stay disconnected or keep reporting errors before its driver is restarted. The AM5 and the PPBA each connected in 10 s on 2026-11-01 (wire); the Pegasus once took 40 to 82 s on Windows' },
} as const

export const nowToken = { value: 'now', description: 'In onConnect, a text value of "now" is written as the current UTC time, YYYY-MM-DDTHH:MM:SS, the form TIME_UTC takes on the wire' } as const

const numberKeys = ['indiPort', 'pollMs', 'settlePolls', 'stopGapMs', 'minRestartGapMs', 'deadLinkMs', 'errorGapMs', 'reconnectWaitMs'] as const

export type WantedValue = number | boolean | string

export type WantedProperties = Readonly<Record<string, Readonly<Record<string, WantedValue>>>>

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

export interface RigConfig extends Record<(typeof numberKeys)[number], number> {
  readonly indiHost: string
  readonly numberTolerance: number
  readonly fifo: string
  readonly backoffMs: ReadonlyArray<number>
  readonly devices: ReadonlyArray<RigDevice>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (message: string): never => {
  throw new Error(`rig config: ${message}`)
}

function parseProperties(device: string, key: string, value: unknown): WantedProperties {
  if (value === undefined) return {}
  if (!isObject(value)) return fail(`device ${device}: ${key} must be an object of properties`)

  const properties: Record<string, Record<string, WantedValue>> = {}

  for (const [property, elements] of Object.entries(value)) {
    if (!isObject(elements) || Object.keys(elements).length === 0) fail(`device ${device}: ${key}.${property} must be an object of element values`)
    const parsed: Record<string, WantedValue> = {}

    for (const [element, wanted] of Object.entries(elements as Record<string, unknown>)) {
      if (!(typeof wanted === 'boolean' || typeof wanted === 'string' || (typeof wanted === 'number' && Number.isFinite(wanted)))) fail(`device ${device}: ${key}.${property}.${element} must be a finite number, a boolean or a string`)
      parsed[element] = wanted as WantedValue
    }
    properties[property] = parsed
  }

  return properties
}

function parseDevice(device: unknown, index: number, ids: Set<string>): RigDevice {
  if (!isObject(device)) return fail(`devices[${index}] must be an object`)
  for (const key of Object.keys(device)) if (!['id', 'indiDevice', 'usb', 'serial', 'driver', 'connected', 'properties', 'onConnect'].includes(key)) fail(`devices[${index}]: unknown key ${key}`)

  const { id, indiDevice, usb, serial, driver, connected } = device

  if (typeof id !== 'string' || id === '') return fail(`devices[${index}].id is required`)
  if (typeof indiDevice !== 'string' || indiDevice === '') return fail(`device ${id}: indiDevice is required`)
  if (ids.has(id)) fail(`device ${id} is listed twice`)
  ids.add(id)
  if ((usb === undefined) === (serial === undefined)) fail(`device ${id}: give exactly one of usb and serial`)
  if (usb !== undefined && !(typeof usb === 'string' && /^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$/.test(usb))) fail(`device ${id}: usb must look like 03c3:260a`)
  if (serial !== undefined && (typeof serial !== 'string' || !serial.startsWith('/'))) fail(`device ${id}: serial must be an absolute path`)
  if (typeof driver !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(driver)) fail(`device ${id}: driver must be an executable name`)
  if (typeof connected !== 'boolean') fail(`device ${id}: connected must be true or false`)

  const wanted = parseProperties(id, 'properties', device.properties)

  if (serial !== undefined && 'DEVICE_PORT' in wanted) fail(`device ${id}: DEVICE_PORT comes from serial`)

  return {
    id,
    indiDevice,
    ...(typeof usb === 'string' && { usb: usb.toLowerCase() }),
    ...(typeof serial === 'string' && { serial }),
    driver: driver as string,
    connected: connected as boolean,
    properties: typeof serial === 'string' ? { DEVICE_PORT: { PORT: serial }, ...wanted } : wanted,
    onConnect: parseProperties(id, 'onConnect', device.onConnect),
  }
}

export function parseConfig(json: unknown, environment: { readonly runtimeDir?: string | undefined } = {}): RigConfig {
  if (!isObject(json)) return fail('expected a JSON object')

  const known = ['fifo', 'devices', ...Object.keys(settings)]
  for (const key of Object.keys(json)) if (!known.includes(key)) fail(`unknown key ${key}`)

  const fifo = json.fifo ?? (environment.runtimeDir ? join(environment.runtimeDir, 'indi.fifo') : undefined)
  if (typeof fifo !== 'string' || fifo === '') return fail('fifo is required when XDG_RUNTIME_DIR is not set')

  const numbers = {} as Record<(typeof numberKeys)[number], number>
  for (const key of numberKeys) {
    const value = json[key] ?? settings[key].value
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || (key !== 'stopGapMs' && value < 1)) fail(`${key} must be a positive integer`)
    numbers[key] = value as number
  }

  const numberTolerance = json.numberTolerance ?? settings.numberTolerance.value
  if (typeof numberTolerance !== 'number' || !(numberTolerance >= 0)) return fail('numberTolerance must be a number, 0 or more')

  const backoffMs = json.backoffMs ?? settings.backoffMs.value
  if (!Array.isArray(backoffMs) || backoffMs.length === 0 || !backoffMs.every(value => Number.isInteger(value) && value > 0)) return fail('backoffMs must be a non-empty array of positive integers')

  const indiHost = json.indiHost ?? settings.indiHost.value
  if (typeof indiHost !== 'string' || indiHost === '') return fail('indiHost must be a host name')

  if (!Array.isArray(json.devices) || json.devices.length === 0) return fail('devices must be a non-empty array')

  const ids = new Set<string>()
  const devices = json.devices.map((device: unknown, index: number) => parseDevice(device, index, ids))

  return { indiHost, fifo, numberTolerance, backoffMs: backoffMs as ReadonlyArray<number>, ...numbers, devices }
}
