#!/usr/bin/env node
// rig-supervisor: brings rig devices up as they are powered, in any order.
//
// Cria never restarts a driver and never connects a device on its own. Chris
// asked on 2026-10-16 for an outside process that does exactly two things, so
// the mini PC can boot before the rest of the rig is powered:
//
//   a. A device is missing from INDI (availability `unavailable`), its hardware
//      is present, and nothing is open or held on any device that driver
//      serves: restart only that driver through indiserver's FIFO.
//   b. A device is defined but disconnected (availability `disconnected`), its
//      hardware is present, commands are enabled, and nothing is open or held
//      on it: send one device-connect through Cria's HTTP API. Cria writes the
//      serial port first and runs device setup itself.
//
// It never switches power, never moves anything and never exposes. When Cria is
// unreachable, or commands are disabled, it does nothing. docs/runtime.md says
// why and how to turn it off. Node built-ins only; the core is `createSupervisor`
// with every effect injected, so the tests run it on a fake clock.
import { randomUUID } from 'node:crypto'
import { constants, existsSync, readFileSync, readdirSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/** Delay before the next try after the 1st, 2nd and later failure. */
export const backoffMs = [10_000, 30_000, 60_000]

/** One driver is restarted at most once in this long, whatever the backoff says. */
export const minRestartGapMs = 20_000

const defaults = {
  criaUrl: 'http://127.0.0.1:4319',
  pollMs: 5_000,
  // A device must look the same on this many polls in a row before the supervisor acts.
  // Cria reports `unavailable` for ~2 s after it (re)connects to indiserver, and a
  // USB device can show in sysfs before it can be opened.
  settlePolls: 2,
  // Between `stop` and `start` on the FIFO, so indiserver has dropped the old process.
  stopGapMs: 1_000,
  requestTimeoutMs: 5_000,
}

/**
 * @typedef {{ id: string, usb?: string, serial?: string, driver?: string }} DeviceConfig
 * @typedef {{ criaUrl: string, fifo: string, pollMs: number, settlePolls: number, stopGapMs: number, requestTimeoutMs: number, devices: DeviceConfig[] }} Config
 */

/**
 * @param {unknown} json
 * @param {{ runtimeDir?: string }} [environment]
 * @returns {Config}
 */
export function parseConfig(json, environment = {}) {
  const fail = message => {
    throw new Error(`supervisor config: ${message}`)
  }
  const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

  if (!isObject(json)) fail('expected a JSON object')

  const known = ['criaUrl', 'fifo', 'pollMs', 'settlePolls', 'stopGapMs', 'requestTimeoutMs', 'devices']
  for (const key of Object.keys(json)) if (!known.includes(key)) fail(`unknown key ${key}`)

  const fifo = json.fifo ?? (environment.runtimeDir ? join(environment.runtimeDir, 'indi.fifo') : undefined)
  if (typeof fifo !== 'string' || fifo === '') fail('fifo is required when XDG_RUNTIME_DIR is not set')

  const numbers = {}
  for (const key of ['pollMs', 'settlePolls', 'stopGapMs', 'requestTimeoutMs']) {
    const value = json[key] ?? defaults[key]
    if (!Number.isInteger(value) || value < 0 || (key !== 'stopGapMs' && value < 1)) fail(`${key} must be a positive integer`)
    numbers[key] = value
  }

  const criaUrl = json.criaUrl ?? defaults.criaUrl
  if (typeof criaUrl !== 'string' || !/^https?:\/\//.test(criaUrl)) fail('criaUrl must be an http(s) URL')

  if (!Array.isArray(json.devices) || json.devices.length === 0) fail('devices must be a non-empty array')

  const ids = new Set()
  const devices = json.devices.map((device, index) => {
    if (!isObject(device)) fail(`devices[${index}] must be an object`)
    for (const key of Object.keys(device)) if (!['id', 'usb', 'serial', 'driver'].includes(key)) fail(`devices[${index}]: unknown key ${key}`)
    if (typeof device.id !== 'string' || device.id === '') fail(`devices[${index}].id is required`)
    if (ids.has(device.id)) fail(`device ${device.id} is listed twice`)
    ids.add(device.id)
    if ((device.usb === undefined) === (device.serial === undefined)) fail(`device ${device.id}: give exactly one of usb and serial`)
    if (device.usb !== undefined && !/^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$/.test(device.usb)) fail(`device ${device.id}: usb must look like 03c3:260a`)
    if (device.serial !== undefined && (typeof device.serial !== 'string' || !device.serial.startsWith('/'))) fail(`device ${device.id}: serial must be an absolute path`)
    if (device.driver !== undefined) {
      if (device.usb === undefined) fail(`device ${device.id}: driver only goes with usb (a serial device's driver always defines it)`)
      if (typeof device.driver !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(device.driver)) fail(`device ${device.id}: driver must be an executable name`)
    }

    return { id: device.id, ...(device.usb && { usb: device.usb.toLowerCase() }), ...(device.serial && { serial: device.serial }), ...(device.driver && { driver: device.driver }) }
  })

  return { criaUrl: criaUrl.replace(/\/+$/, ''), fifo, ...numbers, devices }
}

/** Is a USB device with this `vid:pid` attached? Reads sysfs only. */
export function usbAttached(vidPid, sysfs = '/sys/bus/usb/devices') {
  const [vendor, product] = vidPid.toLowerCase().split(':')
  const read = (entry, file) => {
    try {
      return readFileSync(join(sysfs, entry, file), 'utf8').trim().toLowerCase()
    } catch {
      return undefined
    }
  }

  try {
    return readdirSync(sysfs).some(entry => read(entry, 'idVendor') === vendor && read(entry, 'idProduct') === product)
  } catch {
    return false
  }
}

/** The real hardware check for a configured device. */
export const hardwarePresent = device => (device.usb ? usbAttached(device.usb) : existsSync(device.serial))

/**
 * Writes one command line to indiserver's FIFO. The open is non-blocking, so with
 * no indiserver reading it fails at once (ENXIO) instead of hanging.
 */
export async function writeFifo(path, line) {
  const handle = await open(path, constants.O_WRONLY | constants.O_NONBLOCK)

  try {
    await handle.write(`${line}\n`)
  } finally {
    await handle.close()
  }
}

const isOpen = operation => operation.state !== 'settled'

/** Things that make restarting a driver unsafe, found on the devices it serves. */
function activeOn(devices) {
  return devices.flatMap(device => {
    const readings = device.readings ?? {}
    const active = [readings.activity?.value === 'exposing' && 'exposing', readings.slewing?.value === true && 'slewing', readings.moving?.value === true && 'moving'].filter(Boolean)

    return active.map(what => `${device.id} is ${what}`)
  })
}

/**
 * @param {{
 *   config: Config,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 *   fetch: typeof fetch,
 *   hardwarePresent: (device: DeviceConfig) => boolean | Promise<boolean>,
 *   writeFifo: (path: string, line: string) => Promise<void>,
 *   log: (line: string) => void,
 *   uuid?: () => string,
 *   token?: string,
 * }} dependencies
 */
export function createSupervisor(dependencies) {
  const { config, now, sleep, log } = dependencies
  const uuid = dependencies.uuid ?? randomUUID
  const headers = dependencies.token ? { authorization: `Bearer ${dependencies.token}` } : {}

  /** @type {Map<string, { hardwareStreak: number, missingStreak: number, attempts: number, lastAttemptAt?: number, quiet?: string }>} */
  const devices = new Map(config.devices.map(device => [device.id, { hardwareStreak: 0, missingStreak: 0, attempts: 0 }]))
  /** @type {Map<string, { restarts: number, lastRestartAt?: number }>} */
  const drivers = new Map()
  /** What was last logged per subject, so a steady wait logs once, not every poll. */
  const said = new Map()
  let criaReachable = true

  const note = (subject, line) => {
    if (said.get(subject) === line) return
    said.set(subject, line)
    log(`rig-supervisor: ${line}`)
  }
  const clearNote = subject => said.delete(subject)

  const request = (path, init = {}) =>
    dependencies.fetch(`${config.criaUrl}${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(config.requestTimeoutMs) })

  async function readState() {
    try {
      const response = await request('/v2/state')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const state = await response.json()
      if (state?.protocolVersion !== 5 || !Array.isArray(state.devices) || !Array.isArray(state.operations)) throw new Error('not a protocol 5 state')

      return state
    } catch (error) {
      note('cria', `Cria unreachable (${error instanceof Error ? error.message : String(error)}); doing nothing`)
      criaReachable = false

      return undefined
    }
  }

  async function connect(device, entry, current, state) {
    const requestId = `supervisor-${uuid()}`
    entry.attempts += 1
    entry.lastAttemptAt = now()

    try {
      const response = await request('/v2/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instanceId: state.instanceId,
          requestId,
          deviceId: device.id,
          bindingId: current.bindingId,
          expectedName: current.name,
          kind: 'device-connect',
          parameters: { connected: true },
        }),
      })

      if (response.status === 202) {
        log(`rig-supervisor: ${device.id}: device-connect sent (${requestId}, attempt ${entry.attempts})`)

        return
      }

      const body = await response.json().catch(() => undefined)
      const code = body?.error?.code ?? `HTTP ${response.status}`

      if (code === 'device-blocked' || code === 'commands-disabled' || code === 'device-busy') {
        entry.quiet = code
        log(`rig-supervisor: ${device.id}: device-connect refused ${code}; waiting until that clears`)
      } else {
        log(`rig-supervisor: ${device.id}: device-connect refused ${code}; trying again after the backoff`)
      }
    } catch (error) {
      // Whether Cria admitted it is unknown. A new attempt gets a new request ID, and
      // an operation it did admit is open in the next state, which stops the next one.
      log(`rig-supervisor: ${device.id}: device-connect (${requestId}) got no answer: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const connectWait = entry => backoffMs[Math.max(0, Math.min(entry.attempts, backoffMs.length) - 1)]

  async function restartDriver(driver, bookkeeping, reason) {
    bookkeeping.restarts += 1
    bookkeeping.lastRestartAt = now()
    log(`rig-supervisor: ${driver}: restarting (${reason}; restart ${bookkeeping.restarts})`)

    try {
      await dependencies.writeFifo(config.fifo, `stop ${driver}`)
      await sleep(config.stopGapMs)
      await dependencies.writeFifo(config.fifo, `start ${driver}`)
    } catch (error) {
      log(`rig-supervisor: ${driver}: FIFO write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function tick() {
    const state = await readState()

    if (!state) {
      for (const entry of devices.values()) {
        entry.hardwareStreak = 0
        entry.missingStreak = 0
      }

      return
    }
    if (!criaReachable) {
      criaReachable = true
      clearNote('cria')
      log('rig-supervisor: Cria reachable again')
    }
    if (!state.commandsEnabled) {
      note('commands', 'Cria has commands disabled; doing nothing')

      return
    }
    clearNote('commands')

    const byId = new Map(state.devices.map(device => [device.id, device]))
    // Every device unavailable means indiserver (or Cria's link to it) is down, not that every driver lost its device.
    const linkDown = state.devices.length > 0 && state.devices.every(device => device.availability.reason === 'unavailable')
    const restarting = new Set()

    for (const configured of config.devices) {
      const entry = devices.get(configured.id)
      const current = byId.get(configured.id)

      if (!current) {
        note(`unknown:${configured.id}`, `${configured.id}: Cria has no such device; ignoring it`)
        entry.hardwareStreak = 0
        entry.missingStreak = 0
        continue
      }
      entry.hardwareStreak = (await dependencies.hardwarePresent(configured)) ? entry.hardwareStreak + 1 : 0
      entry.missingStreak = !linkDown && current.availability.reason === 'unavailable' ? entry.missingStreak + 1 : 0
      if (current.availability.reason !== 'disconnected') entry.attempts = 0
    }

    // Rule a: a missing device whose hardware is present gets its driver restarted.
    const driverNames = [...new Set(config.devices.flatMap(device => (device.driver ? [device.driver] : [])))]

    for (const driver of driverNames) {
      const group = config.devices.filter(device => device.driver === driver)
      const served = group.flatMap(device => byId.get(device.id) ?? [])
      const bookkeeping = drivers.get(driver) ?? { restarts: 0 }
      drivers.set(driver, bookkeeping)

      const wanting = group.filter(device => {
        const entry = devices.get(device.id)

        return entry.missingStreak >= config.settlePolls && entry.hardwareStreak >= config.settlePolls
      })

      if (group.every(device => devices.get(device.id).missingStreak === 0)) bookkeeping.restarts = 0
      if (wanting.length === 0) {
        clearNote(`driver:${driver}`)
        continue
      }

      const ids = new Set(served.map(device => device.id))
      const domains = new Set(served.map(device => device.failureDomain))
      const blockers = [
        ...state.operations.filter(operation => isOpen(operation) && (ids.has(operation.deviceId) || domains.has(operation.failureDomain))).map(operation => `${operation.kind} open on ${operation.deviceId}`),
        ...served.filter(device => device.quarantine?.held).map(device => `${device.id} is held`),
        ...activeOn(served),
      ]

      if (blockers.length > 0) {
        note(`driver:${driver}`, `${driver}: ${wanting.map(device => device.id).join(', ')} missing with hardware present, but ${blockers.join('; ')}; not restarting`)
        continue
      }

      const wait = Math.max(minRestartGapMs, bookkeeping.restarts === 0 ? 0 : backoffMs[Math.min(bookkeeping.restarts, backoffMs.length) - 1])
      const due = bookkeeping.lastRestartAt === undefined || now() - bookkeeping.lastRestartAt >= wait

      if (!due) {
        note(`driver:${driver}`, `${driver}: waiting ${wait / 1000} s between restarts`)
        continue
      }

      clearNote(`driver:${driver}`)
      restarting.add(driver)
      await restartDriver(driver, bookkeeping, `${wanting.map(device => device.id).join(', ')} missing from INDI with hardware present`)
    }

    // Rule b: a defined, disconnected device whose hardware is present gets one device-connect.
    for (const configured of config.devices) {
      const entry = devices.get(configured.id)
      const current = byId.get(configured.id)

      if (!current || current.availability.reason !== 'disconnected') {
        clearNote(`connect:${configured.id}`)
        entry.quiet = undefined
        continue
      }
      if (configured.driver && restarting.has(configured.driver)) continue

      const open = state.operations.some(operation => isOpen(operation) && (operation.deviceId === current.id || operation.failureDomain === current.failureDomain))
      const held = current.quarantine?.held === true

      if (entry.quiet) {
        const cleared = (entry.quiet === 'device-blocked' && !held) || (entry.quiet === 'commands-disabled' && state.commandsEnabled) || (entry.quiet === 'device-busy' && !open)

        if (!cleared) continue
        entry.quiet = undefined
      }
      if (entry.hardwareStreak < config.settlePolls) {
        note(`connect:${configured.id}`, `${configured.id}: disconnected, hardware not present yet`)
        continue
      }
      if (open || held) {
        note(`connect:${configured.id}`, `${configured.id}: disconnected, but ${held ? 'it is held' : 'an operation is open'}; not connecting`)
        continue
      }
      if (entry.lastAttemptAt !== undefined && now() - entry.lastAttemptAt < connectWait(entry)) continue

      clearNote(`connect:${configured.id}`)
      await connect(configured, entry, current, state)
    }
  }

  return { tick }
}

function main() {
  const path = process.argv[2] ?? process.env.RIG_SUPERVISOR_CONFIG ?? join(homedir(), '.config/cria/supervisor.json')
  let config

  try {
    config = parseConfig(JSON.parse(readFileSync(path, 'utf8')), { runtimeDir: process.env.XDG_RUNTIME_DIR })
  } catch (error) {
    console.error(`rig-supervisor: ${path}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  const supervisor = createSupervisor({
    config,
    now: Date.now,
    sleep: ms => delay(ms),
    fetch,
    hardwarePresent,
    writeFifo,
    log: line => console.log(line),
    ...(process.env.CRIA_TOKEN && { token: process.env.CRIA_TOKEN }),
  })
  let running = true

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      console.log(`rig-supervisor: ${signal}, stopping`)
      running = false
      process.exit(0)
    })
  }

  console.log(`rig-supervisor: watching ${config.devices.map(device => device.id).join(', ')} (config ${path})`)
  void (async () => {
    while (running) {
      try {
        await supervisor.tick()
      } catch (error) {
        console.log(`rig-supervisor: poll failed: ${error instanceof Error ? error.stack : String(error)}`)
      }
      await delay(config.pollMs)
    }
  })()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
