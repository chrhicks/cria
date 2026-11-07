#!/usr/bin/env node
import { constants, existsSync, readFileSync, readdirSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

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
}

const numberKeys = ['indiPort', 'pollMs', 'settlePolls', 'stopGapMs', 'requestTimeoutMs', 'connectRequestTimeoutMs', 'minRestartGapMs']

export function parseConfig(json, environment = {}) {
  const fail = message => {
    throw new Error(`supervisor config: ${message}`)
  }
  const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

  if (!isObject(json)) fail('expected a JSON object')

  const known = ['fifo', 'devices', ...Object.keys(settings)]
  for (const key of Object.keys(json)) if (!known.includes(key)) fail(`unknown key ${key}`)

  const fifo = json.fifo ?? (environment.runtimeDir ? join(environment.runtimeDir, 'indi.fifo') : undefined)
  if (typeof fifo !== 'string' || fifo === '') fail('fifo is required when XDG_RUNTIME_DIR is not set')

  const numbers = {}
  for (const key of numberKeys) {
    const value = json[key] ?? settings[key].value
    if (!Number.isInteger(value) || value < 0 || (key !== 'stopGapMs' && value < 1)) fail(`${key} must be a positive integer`)
    numbers[key] = value
  }

  const backoffMs = json.backoffMs ?? settings.backoffMs.value
  if (!Array.isArray(backoffMs) || backoffMs.length === 0 || !backoffMs.every(value => Number.isInteger(value) && value > 0)) fail('backoffMs must be a non-empty array of positive integers')

  const criaUrl = json.criaUrl ?? settings.criaUrl.value
  if (typeof criaUrl !== 'string' || !/^https?:\/\//.test(criaUrl)) fail('criaUrl must be an http(s) URL')

  const indiHost = json.indiHost ?? settings.indiHost.value
  if (typeof indiHost !== 'string' || indiHost === '') fail('indiHost must be a host name')

  if (!Array.isArray(json.devices) || json.devices.length === 0) fail('devices must be a non-empty array')

  const ids = new Set()
  const devices = json.devices.map((device, index) => {
    if (!isObject(device)) fail(`devices[${index}] must be an object`)
    for (const key of Object.keys(device)) if (!['id', 'indiDevice', 'usb', 'serial', 'driver'].includes(key)) fail(`devices[${index}]: unknown key ${key}`)
    if (typeof device.id !== 'string' || device.id === '') fail(`devices[${index}].id is required`)
    if (typeof device.indiDevice !== 'string' || device.indiDevice === '') fail(`device ${device.id}: indiDevice is required`)
    if (ids.has(device.id)) fail(`device ${device.id} is listed twice`)
    ids.add(device.id)
    if ((device.usb === undefined) === (device.serial === undefined)) fail(`device ${device.id}: give exactly one of usb and serial`)
    if (device.usb !== undefined && !/^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$/.test(device.usb)) fail(`device ${device.id}: usb must look like 03c3:260a`)
    if (device.serial !== undefined && (typeof device.serial !== 'string' || !device.serial.startsWith('/'))) fail(`device ${device.id}: serial must be an absolute path`)
    if (device.driver !== undefined) {
      if (device.usb === undefined) fail(`device ${device.id}: driver only goes with usb (a serial device's driver always defines it)`)
      if (typeof device.driver !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(device.driver)) fail(`device ${device.id}: driver must be an executable name`)
    }

    return {
      id: device.id,
      indiDevice: device.indiDevice,
      ...(device.usb && { usb: device.usb.toLowerCase() }),
      ...(device.serial && { serial: device.serial }),
      ...(device.driver && { driver: device.driver }),
    }
  })

  return { criaUrl: criaUrl.replace(/\/+$/, ''), indiHost, fifo, backoffMs, ...numbers, devices }
}

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

export const hardwarePresent = device => (device.usb ? usbAttached(device.usb) : existsSync(device.serial))

export async function writeFifo(path, line) {
  const handle = await open(path, constants.O_WRONLY | constants.O_NONBLOCK)

  try {
    await handle.write(`${line}\n`)
  } finally {
    await handle.close()
  }
}

export function indiFacts(properties) {
  if (properties.length === 0) return undefined
  const connection = properties.find(property => property.name === 'CONNECTION')
  const connect = connection?.elements.get('CONNECT')
  const state = connection?.state === 'Busy' ? 'changing' : connect?.kind === 'switch' && connect.on ? 'connected' : 'disconnected'

  return { connection: state, busy: properties.filter(property => property.state === 'Busy').map(property => property.name) }
}

export async function openIndiView({ host, port, devices }) {
  const { Effect, Exit, Scope } = await import('effect')
  const { makeIndiClient } = await import('../packages/indi/dist/index.js')
  const scope = Effect.runSync(Scope.make())
  const client = await Effect.runPromise(Scope.provide(makeIndiClient({ host, port, warn: () => {} }), scope))

  return {
    view: async () => {
      const status = await Effect.runPromise(client.status)
      const facts = new Map()

      for (const name of devices) {
        const found = indiFacts(await Effect.runPromise(client.device(name).properties))

        if (found) facts.set(name, found)
      }

      return { linked: status.kind === 'connected', devices: facts }
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

const errorText = error => (error instanceof Error ? error.message : String(error))

export function createSupervisor(dependencies) {
  const { config, now, sleep, log, indi } = dependencies
  const devices = new Map(config.devices.map(device => [device.id, { hardwareStreak: 0, missingStreak: 0, attempts: 0 }]))
  const drivers = new Map()
  const said = new Map()
  let criaReachable = true
  let lastInstanceId

  const note = (subject, line) => {
    if (said.get(subject) === line) return
    said.set(subject, line)
    log(`rig-supervisor: ${line}`)
  }
  const clearNote = subject => said.delete(subject)
  const wait = attempts => config.backoffMs[Math.max(0, Math.min(attempts, config.backoffMs.length) - 1)]

  const request = (path, init = {}, timeoutMs = config.requestTimeoutMs) =>
    dependencies.fetch(`${config.criaUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) })

  async function readHealth() {
    try {
      const response = await request('/health')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const health = await response.json()
      if (typeof health?.instanceId !== 'string') throw new Error('health names no instance')

      return health
    } catch (error) {
      note('cria', `Cria unreachable (${errorText(error)}); doing nothing`)
      criaReachable = false

      return undefined
    }
  }

  async function connect(configured, entry, instanceId) {
    entry.attempts += 1
    entry.lastAttemptAt = now()
    log(`rig-supervisor: ${configured.id}: device-connect sent (attempt ${entry.attempts})`)

    try {
      const response = await request(
        '/connect',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: configured.id, connected: true }) },
        config.connectRequestTimeoutMs,
      )
      const body = await response.json().catch(() => undefined)

      if (response.status === 200 && body?.outcome === 'confirmed') {
        entry.setUpIn = instanceId
        entry.attempts = 0
        log(`rig-supervisor: ${configured.id}: set up`)

        return
      }

      log(`rig-supervisor: ${configured.id}: device-connect ${body?.outcome ?? `HTTP ${response.status}`}${body?.message ? ` (${body.message})` : ''}; trying again after the backoff`)
    } catch (error) {
      log(`rig-supervisor: ${configured.id}: device-connect got no answer: ${errorText(error)}; trying again after the backoff`)
    }
  }

  async function restartDriver(driver, bookkeeping, reason) {
    bookkeeping.restarts += 1
    bookkeeping.lastRestartAt = now()
    log(`rig-supervisor: ${driver}: restarting (${reason}; restart ${bookkeeping.restarts})`)

    try {
      await dependencies.writeFifo(config.fifo, `stop ${driver}`)
      await sleep(config.stopGapMs)
      await dependencies.writeFifo(config.fifo, `start ${driver}`)
    } catch (error) {
      log(`rig-supervisor: ${driver}: FIFO write failed: ${errorText(error)}`)
    }
  }

  async function tick() {
    const health = await readHealth()

    if (!health) {
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
    if (lastInstanceId !== undefined && health.instanceId !== lastInstanceId) {
      log(`rig-supervisor: Cria restarted (instance ${health.instanceId}); every device needs setting up again`)
      for (const entry of devices.values()) entry.setUpIn = undefined
    }
    lastInstanceId = health.instanceId

    const view = await indi.view()
    const linkDown = !view.linked || config.devices.every(device => !view.devices.has(device.indiDevice))

    if (linkDown) note('indi', 'indiserver unreachable, or no configured device defined; restarting nothing')
    else clearNote('indi')

    for (const configured of config.devices) {
      const entry = devices.get(configured.id)
      const current = view.devices.get(configured.indiDevice)

      entry.hardwareStreak = (await dependencies.hardwarePresent(configured)) ? entry.hardwareStreak + 1 : 0
      entry.missingStreak = !linkDown && !current ? entry.missingStreak + 1 : 0
      if (linkDown || !current || current.connection === 'disconnected') entry.setUpIn = undefined
    }

    const restarting = new Set()
    const driverNames = [...new Set(config.devices.flatMap(device => (device.driver ? [device.driver] : [])))]

    for (const driver of driverNames) {
      const group = config.devices.filter(device => device.driver === driver)
      const bookkeeping = drivers.get(driver) ?? { restarts: 0 }
      drivers.set(driver, bookkeeping)

      if (group.every(device => devices.get(device.id).missingStreak === 0)) bookkeeping.restarts = 0

      const wanting = group.filter(device => {
        const entry = devices.get(device.id)

        return entry.missingStreak >= config.settlePolls && entry.hardwareStreak >= config.settlePolls
      })

      if (wanting.length === 0) {
        clearNote(`driver:${driver}`)
        continue
      }

      const blockers = group.flatMap(device => (view.devices.get(device.indiDevice)?.busy ?? []).map(name => `${device.id} ${name} is Busy`))

      if (blockers.length > 0) {
        note(`driver:${driver}`, `${driver}: ${wanting.map(device => device.id).join(', ')} missing with hardware present, but ${blockers.join('; ')}; not restarting`)
        continue
      }

      const gap = Math.max(config.minRestartGapMs, bookkeeping.restarts === 0 ? 0 : wait(bookkeeping.restarts))

      if (bookkeeping.lastRestartAt !== undefined && now() - bookkeeping.lastRestartAt < gap) {
        note(`driver:${driver}`, `${driver}: waiting ${gap / 1000} s between restarts`)
        continue
      }

      clearNote(`driver:${driver}`)
      restarting.add(driver)
      await restartDriver(driver, bookkeeping, `${wanting.map(device => device.id).join(', ')} missing from INDI with hardware present`)
    }

    for (const configured of config.devices) {
      const entry = devices.get(configured.id)
      const current = view.devices.get(configured.indiDevice)
      const wants = !linkDown && current !== undefined && current.connection !== 'changing' && (current.connection === 'disconnected' || entry.setUpIn !== health.instanceId)

      if (!wants) {
        clearNote(`connect:${configured.id}`)
        if (entry.setUpIn === health.instanceId) entry.attempts = 0
        continue
      }
      if (configured.driver && restarting.has(configured.driver)) continue
      if (entry.hardwareStreak < config.settlePolls) {
        note(`connect:${configured.id}`, `${configured.id}: ${current.connection}, hardware not present yet`)
        continue
      }
      if (entry.lastAttemptAt !== undefined && now() - entry.lastAttemptAt < wait(entry.attempts)) continue

      clearNote(`connect:${configured.id}`)
      await connect(configured, entry, health.instanceId)
    }
  }

  return { tick }
}

async function main() {
  const path = process.argv[2] ?? process.env.RIG_SUPERVISOR_CONFIG ?? join(homedir(), '.config/cria/supervisor.json')
  let config

  try {
    config = parseConfig(JSON.parse(readFileSync(path, 'utf8')), { runtimeDir: process.env.XDG_RUNTIME_DIR })
  } catch (error) {
    console.error(`rig-supervisor: ${path}: ${errorText(error)}`)
    process.exit(2)
  }

  const indi = await openIndiView({ host: config.indiHost, port: config.indiPort, devices: config.devices.map(device => device.indiDevice) })
  const supervisor = createSupervisor({ config, now: Date.now, sleep: ms => delay(ms), fetch, hardwarePresent, writeFifo, indi, log: line => console.log(line) })
  let running = true

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      console.log(`rig-supervisor: ${signal}, stopping`)
      running = false
      void indi.close().finally(() => process.exit(0))
    })
  }

  console.log(`rig-supervisor: watching ${config.devices.map(device => device.id).join(', ')} (config ${path})`)
  while (running) {
    try {
      await supervisor.tick()
    } catch (error) {
      console.log(`rig-supervisor: poll failed: ${error instanceof Error ? error.stack : String(error)}`)
    }
    await delay(config.pollMs)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
