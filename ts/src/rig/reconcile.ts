import { nowToken, type RigConfig, type RigDevice, type WantedValue } from './config.ts'
import type { DeviceFacts, IndiSnapshot, PropertyFacts } from './indi-link.ts'

export type Action =
  | { readonly kind: 'write'; readonly device: string; readonly indiDevice: string; readonly property: string; readonly values: Readonly<Record<string, WantedValue>>; readonly why: string }
  | { readonly kind: 'restart-driver'; readonly driver: string; readonly why: string }
  | { readonly kind: 'log'; readonly line: string }

interface DeviceMemory {
  hardwareStreak: number
  missingStreak: number
  wasConnected: boolean
  pendingOnConnect: string[]
  busy: string[]
  reconnectedAt?: number
}

interface DriverMemory {
  restarts: number
  lastRestartAt?: number
}

interface WriteMemory {
  attempts: number
  at: number
}

export interface Memory {
  devices: Record<string, DeviceMemory>
  drivers: Record<string, DriverMemory>
  writes: Record<string, WriteMemory>
  said: Record<string, string>
}

interface Observation {
  readonly now: number
  readonly snapshot: IndiSnapshot
  readonly hardware: Readonly<Record<string, boolean>>
}

export const emptyMemory = (config: RigConfig): Memory => ({
  devices: Object.fromEntries(config.devices.map(device => [device.id, { hardwareStreak: 0, missingStreak: 0, wasConnected: false, pendingOnConnect: [], busy: [] }])),
  drivers: {},
  writes: {},
  said: {},
})

const utcWire = (now: number) => new Date(now).toISOString().slice(0, 19)

const resolve = (values: Readonly<Record<string, WantedValue>>, now: number) =>
  Object.fromEntries(Object.entries(values).map(([element, value]) => [element, value === nowToken.value ? utcWire(now) : value]))

export function holds(found: PropertyFacts, wanted: Readonly<Record<string, WantedValue>>, tolerance: number): boolean {
  return Object.entries(wanted).every(([element, value]) => {
    const actual = found.values[element]

    return typeof value === 'number' ? typeof actual === 'number' && Math.abs(actual - value) <= tolerance : actual === value
  })
}

export function decide(config: RigConfig, observation: Observation, previous: Memory): { readonly actions: ReadonlyArray<Action>; readonly memory: Memory } {
  const memory = structuredClone(previous)
  const actions: Action[] = []
  const { now, snapshot } = observation
  const wait = (attempts: number) => config.backoffMs[Math.max(0, Math.min(attempts, config.backoffMs.length) - 1)]!
  const note = (subject: string, line: string) => {
    if (memory.said[subject] === line) return
    memory.said[subject] = line
    actions.push({ kind: 'log', line })
  }
  const clearNote = (subject: string) => {
    delete memory.said[subject]
  }
  const memoryOf = (device: RigDevice) => memory.devices[device.id]!
  const factsOf = (device: RigDevice): DeviceFacts | undefined => snapshot.devices.get(device.indiDevice)
  const writable = (key: string) => {
    const written = memory.writes[key]

    return written === undefined || now - written.at >= wait(written.attempts)
  }
  const wrote = (key: string) => {
    memory.writes[key] = { attempts: (memory.writes[key]?.attempts ?? 0) + 1, at: now }
  }
  const attempt = (key: string) => memory.writes[key]?.attempts ?? 0

  const linkDown = !snapshot.linked

  if (linkDown) note('indi', 'indiserver unreachable; writing and restarting nothing')
  else clearNote('indi')

  for (const device of config.devices) {
    const facts = factsOf(device)
    const state = memoryOf(device)
    const connectedNow = !linkDown && facts?.connection === 'connected'

    state.hardwareStreak = observation.hardware[device.id] ? state.hardwareStreak + 1 : 0
    state.missingStreak = !linkDown && !facts ? state.missingStreak + 1 : 0
    if (connectedNow && !state.wasConnected) state.pendingOnConnect = Object.keys(device.onConnect)
    if (!connectedNow) state.pendingOnConnect = []
    state.wasConnected = connectedNow
    if (!linkDown) state.busy = [...new Set([...(facts?.busy ?? []), ...state.busy.filter(name => !facts?.properties.has(name))])]
  }

  const quiet = (device: RigDevice) => {
    const run = factsOf(device)?.errorRun

    return run === undefined || now - run.last > config.errorGapMs
  }
  const deadLink = (device: RigDevice) => {
    const run = factsOf(device)?.errorRun

    return device.serial !== undefined && device.connected && !linkDown && factsOf(device)?.connection === 'connected' && run !== undefined && !quiet(device) && run.last - run.since >= config.deadLinkMs
  }

  const reconnecting = new Set<string>()
  const restartDue = new Set<string>()

  for (const device of config.devices) {
    const state = memoryOf(device)
    const facts = factsOf(device)

    if (state.reconnectedAt !== undefined) {
      if (now - state.reconnectedAt < config.reconnectWaitMs) continue
      if (facts?.connection === 'connected' && quiet(device)) {
        delete state.reconnectedAt
        clearNote(`dead:${device.id}`)
        actions.push({ kind: 'log', line: `rig: ${device.id}: reconnected, driver errors have stopped` })
      } else if (facts?.connection !== 'changing') restartDue.add(device.id)
    } else if (deadLink(device) && state.hardwareStreak >= config.settlePolls) {
      const run = facts!.errorRun!

      state.reconnectedAt = now
      reconnecting.add(device.id)
      actions.push({
        kind: 'write',
        device: device.id,
        indiDevice: device.indiDevice,
        property: 'CONNECTION',
        values: { DISCONNECT: true },
        why: `dead link: the driver has reported errors for ${Math.round((run.last - run.since) / 1000)} s; reconnecting`,
      })
    }
  }

  const restarting = new Set<string>()

  for (const driver of new Set(config.devices.map(device => device.driver))) {
    const group = config.devices.filter(device => device.driver === driver)
    const bookkeeping = (memory.drivers[driver] ??= { restarts: 0 })

    if (group.every(device => memoryOf(device).missingStreak === 0 && !restartDue.has(device.id))) bookkeeping.restarts = 0

    const missing = group.filter(device => memoryOf(device).missingStreak >= config.settlePolls && memoryOf(device).hardwareStreak >= config.settlePolls)
    const dead = group.filter(device => restartDue.has(device.id) && memoryOf(device).hardwareStreak >= config.settlePolls)
    const wanting = [...missing, ...dead]

    if (wanting.length === 0) {
      clearNote(`driver:${driver}`)
      continue
    }

    const blockers = group.flatMap(device => {
      const answers = wanting.includes(device) ? [] : memoryOf(device).busy

      return answers.map(name => (factsOf(device)?.properties.has(name) ? `${device.id} ${name} is Busy` : `${device.id} ${name} was Busy and can no longer be read`))
    })

    if (blockers.length > 0) {
      note(`driver:${driver}`, `rig: ${driver}: ${wanting.map(device => device.id).join(', ')} needs a restart, but ${blockers.join('; ')}; not restarting`)
      continue
    }

    const gap = Math.max(config.minRestartGapMs, bookkeeping.restarts === 0 ? 0 : wait(bookkeeping.restarts))

    if (bookkeeping.lastRestartAt !== undefined && now - bookkeeping.lastRestartAt < gap) {
      note(`driver:${driver}`, `rig: ${driver}: waiting ${gap / 1000} s between restarts`)
      continue
    }

    clearNote(`driver:${driver}`)
    bookkeeping.restarts += 1
    bookkeeping.lastRestartAt = now
    restarting.add(driver)
    for (const device of group) {
      delete memoryOf(device).reconnectedAt
      memoryOf(device).busy = []
    }
    actions.push({
      kind: 'restart-driver',
      driver,
      why: [
        ...(missing.length > 0 ? [`${missing.map(device => device.id).join(', ')} missing from INDI with hardware present`] : []),
        ...(dead.length > 0 ? [`${dead.map(device => device.id).join(', ')} still failing ${config.reconnectWaitMs / 1000} s after a reconnect`] : []),
      ].join('; ') + `; restart ${bookkeeping.restarts}`,
    })
  }

  for (const device of config.devices) {
    const state = memoryOf(device)
    const facts = factsOf(device)
    const connectionKey = `${device.id}/CONNECTION`

    if (linkDown || !facts) {
      clearNote(`hardware:${device.id}`)
      continue
    }
    if (restarting.has(device.driver) || reconnecting.has(device.id) || facts.connection === 'changing') continue
    if (device.connected ? facts.connection === 'connected' : facts.connection === 'disconnected') delete memory.writes[connectionKey]
    if (state.hardwareStreak < config.settlePolls) {
      note(`hardware:${device.id}`, `rig: ${device.id}: ${facts.connection}, hardware not present yet`)
      continue
    }
    clearNote(`hardware:${device.id}`)

    const differing = Object.entries(device.properties).flatMap(([property, wanted]) => {
      const found = facts.properties.get(property)
      const key = `${device.id}/${property}`

      if (found === undefined) return []
      if (holds(found, wanted, config.numberTolerance)) {
        delete memory.writes[key]

        return []
      }

      return [{ property, wanted, key }]
    })
    const writeDifferences = () => {
      for (const { property, wanted, key } of differing) {
        if (!writable(key)) continue
        wrote(key)
        actions.push({ kind: 'write', device: device.id, indiDevice: device.indiDevice, property, values: wanted, why: `differs from the rig file (attempt ${attempt(key)})` })
      }
    }

    if (device.connected && facts.connection === 'disconnected') {
      if (differing.length > 0) writeDifferences()
      else if (writable(connectionKey)) {
        wrote(connectionKey)
        actions.push({ kind: 'write', device: device.id, indiDevice: device.indiDevice, property: 'CONNECTION', values: { CONNECT: true }, why: `disconnected, the rig file wants it connected (attempt ${attempt(connectionKey)})` })
      }
      continue
    }
    if (!device.connected && facts.connection === 'connected') {
      if (writable(connectionKey)) {
        wrote(connectionKey)
        actions.push({ kind: 'write', device: device.id, indiDevice: device.indiDevice, property: 'CONNECTION', values: { DISCONNECT: true }, why: `connected, the rig file wants it disconnected (attempt ${attempt(connectionKey)})` })
      }
      continue
    }

    writeDifferences()
    state.pendingOnConnect = state.pendingOnConnect.filter(property => {
      if (!facts.properties.has(property)) return true
      actions.push({ kind: 'write', device: device.id, indiDevice: device.indiDevice, property, values: resolve(device.onConnect[property]!, now), why: 'once per connection' })

      return false
    })
  }

  return { actions, memory }
}
