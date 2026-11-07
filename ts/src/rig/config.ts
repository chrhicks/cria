import { join } from 'node:path'

export const settings = {
  criaUrl: { value: 'http://127.0.0.1:4319', description: "Cria's HTTP API" },
  indiHost: { value: '127.0.0.1', description: 'Where indiserver listens: the supervisor watches the drivers itself, on errai, so bring-up never depends on thuban' },
  indiPort: { value: 7624, description: 'indiserver port' },
  pollMs: { value: 5_000, description: 'How often the supervisor looks at the rig' },
  settlePolls: { value: 2, description: 'Polls in a row a device must look the same before the supervisor acts: a USB device can show in sysfs before it can be opened, and a restarted driver takes a moment to define its devices' },
  stopGapMs: { value: 1_000, description: 'Between stop and start on the FIFO, so indiserver has dropped the old process' },
  requestTimeoutMs: { value: 5_000, description: 'How long one request to Cria may take before the supervisor treats Cria as unreachable' },
  connectRequestTimeoutMs: { value: 180_000, description: "How long the supervisor waits for Cria's answer to a connect: longer than Cria's connectTimeoutMs and its setup writes, or a slow cold connect looks like no answer" },
  backoffMs: { value: [10_000, 30_000, 60_000], description: 'Wait before the next try after the 1st, 2nd and later failure' },
  minRestartGapMs: { value: 20_000, description: 'One driver is restarted at most once in this long, whatever the backoff says' },
} as const

const numberKeys = ['indiPort', 'pollMs', 'settlePolls', 'stopGapMs', 'requestTimeoutMs', 'connectRequestTimeoutMs', 'minRestartGapMs'] as const

export interface SupervisedDevice {
  readonly id: string
  readonly indiDevice: string
  readonly usb?: string
  readonly serial?: string
  readonly driver?: string
}

export interface SupervisorConfig extends Record<(typeof numberKeys)[number], number> {
  readonly criaUrl: string
  readonly indiHost: string
  readonly fifo: string
  readonly backoffMs: ReadonlyArray<number>
  readonly devices: ReadonlyArray<SupervisedDevice>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (message: string): never => {
  throw new Error(`supervisor config: ${message}`)
}

function parseDevice(device: unknown, index: number, ids: Set<string>): SupervisedDevice {
  if (!isObject(device)) return fail(`devices[${index}] must be an object`)
  for (const key of Object.keys(device)) if (!['id', 'indiDevice', 'usb', 'serial', 'driver'].includes(key)) fail(`devices[${index}]: unknown key ${key}`)

  const { id, indiDevice, usb, serial, driver } = device

  if (typeof id !== 'string' || id === '') return fail(`devices[${index}].id is required`)
  if (typeof indiDevice !== 'string' || indiDevice === '') return fail(`device ${id}: indiDevice is required`)
  if (ids.has(id)) fail(`device ${id} is listed twice`)
  ids.add(id)
  if ((usb === undefined) === (serial === undefined)) fail(`device ${id}: give exactly one of usb and serial`)
  if (usb !== undefined && !(typeof usb === 'string' && /^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$/.test(usb))) fail(`device ${id}: usb must look like 03c3:260a`)
  if (serial !== undefined && (typeof serial !== 'string' || !serial.startsWith('/'))) fail(`device ${id}: serial must be an absolute path`)
  if (driver !== undefined) {
    if (usb === undefined) fail(`device ${id}: driver only goes with usb (a serial device's driver always defines it)`)
    if (typeof driver !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(driver)) fail(`device ${id}: driver must be an executable name`)
  }

  return {
    id,
    indiDevice,
    ...(typeof usb === 'string' && { usb: usb.toLowerCase() }),
    ...(typeof serial === 'string' && { serial }),
    ...(typeof driver === 'string' && { driver }),
  }
}

export function parseConfig(json: unknown, environment: { readonly runtimeDir?: string | undefined } = {}): SupervisorConfig {
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

  const backoffMs = json.backoffMs ?? settings.backoffMs.value
  if (!Array.isArray(backoffMs) || backoffMs.length === 0 || !backoffMs.every(value => Number.isInteger(value) && value > 0)) return fail('backoffMs must be a non-empty array of positive integers')

  const criaUrl = json.criaUrl ?? settings.criaUrl.value
  if (typeof criaUrl !== 'string' || !/^https?:\/\//.test(criaUrl)) return fail('criaUrl must be an http(s) URL')

  const indiHost = json.indiHost ?? settings.indiHost.value
  if (typeof indiHost !== 'string' || indiHost === '') return fail('indiHost must be a host name')

  if (!Array.isArray(json.devices) || json.devices.length === 0) return fail('devices must be a non-empty array')

  const ids = new Set<string>()
  const devices = json.devices.map((device: unknown, index: number) => parseDevice(device, index, ids))

  return { criaUrl: criaUrl.replace(/\/+$/, ''), indiHost, fifo, backoffMs: backoffMs as ReadonlyArray<number>, ...numbers, devices }
}
