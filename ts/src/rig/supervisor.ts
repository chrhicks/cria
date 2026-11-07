import type { SupervisedDevice, SupervisorConfig } from './config.ts'
import type { DeviceFacts, IndiSnapshot } from './indi-view.ts'

export interface SupervisorDependencies {
  readonly config: SupervisorConfig
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly fetch: typeof globalThis.fetch
  readonly hardwarePresent: (device: SupervisedDevice) => boolean | Promise<boolean>
  readonly writeFifo: (path: string, line: string) => Promise<void>
  readonly indi: { readonly view: () => Promise<IndiSnapshot> }
  readonly log: (line: string) => void
}

export interface Supervisor {
  readonly tick: () => Promise<void>
}

interface DeviceEntry {
  hardwareStreak: number
  missingStreak: number
  attempts: number
  lastAttemptAt?: number
  setUpIn?: string | undefined
}

interface DriverEntry {
  restarts: number
  lastRestartAt?: number
}

interface Health {
  readonly instanceId: string
}

interface ConnectAnswer {
  readonly outcome?: string
  readonly message?: string
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createSupervisor(dependencies: SupervisorDependencies): Supervisor {
  const { config, now, sleep, log, indi } = dependencies
  const devices = new Map<string, DeviceEntry>(config.devices.map(device => [device.id, { hardwareStreak: 0, missingStreak: 0, attempts: 0 }]))
  const drivers = new Map<string, DriverEntry>()
  const said = new Map<string, string>()
  let criaReachable = true
  let lastInstanceId: string | undefined

  const entryOf = (id: string) => devices.get(id)!
  const note = (subject: string, line: string) => {
    if (said.get(subject) === line) return
    said.set(subject, line)
    log(`rig-supervisor: ${line}`)
  }
  const clearNote = (subject: string) => said.delete(subject)
  const wait = (attempts: number) => config.backoffMs[Math.max(0, Math.min(attempts, config.backoffMs.length) - 1)]!

  const request = (path: string, init: RequestInit = {}, timeoutMs = config.requestTimeoutMs) =>
    dependencies.fetch(`${config.criaUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) })

  async function readHealth(): Promise<Health | undefined> {
    try {
      const response = await request('/health')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const health = (await response.json()) as { readonly instanceId?: unknown } | null
      if (typeof health?.instanceId !== 'string') throw new Error('health names no instance')

      return { instanceId: health.instanceId }
    } catch (error) {
      note('cria', `Cria unreachable (${errorText(error)}); doing nothing`)
      criaReachable = false

      return undefined
    }
  }

  async function connect(configured: SupervisedDevice, entry: DeviceEntry, instanceId: string) {
    entry.attempts += 1
    entry.lastAttemptAt = now()
    log(`rig-supervisor: ${configured.id}: device-connect sent (attempt ${entry.attempts})`)

    try {
      const response = await request(
        '/connect',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: configured.id, connected: true }) },
        config.connectRequestTimeoutMs,
      )
      const body = (await response.json().catch(() => undefined)) as ConnectAnswer | undefined

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

  async function restartDriver(driver: string, bookkeeping: DriverEntry, reason: string) {
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
      const entry = entryOf(configured.id)
      const current: DeviceFacts | undefined = view.devices.get(configured.indiDevice)

      entry.hardwareStreak = (await dependencies.hardwarePresent(configured)) ? entry.hardwareStreak + 1 : 0
      entry.missingStreak = !linkDown && !current ? entry.missingStreak + 1 : 0
      if (linkDown || !current || current.connection === 'disconnected') entry.setUpIn = undefined
    }

    const restarting = new Set<string>()
    const driverNames = [...new Set(config.devices.flatMap(device => (device.driver ? [device.driver] : [])))]

    for (const driver of driverNames) {
      const group = config.devices.filter(device => device.driver === driver)
      const bookkeeping = drivers.get(driver) ?? { restarts: 0 }
      drivers.set(driver, bookkeeping)

      if (group.every(device => entryOf(device.id).missingStreak === 0)) bookkeeping.restarts = 0

      const wanting = group.filter(device => {
        const entry = entryOf(device.id)

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
      const entry = entryOf(configured.id)
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
