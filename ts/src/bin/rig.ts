import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseConfig, type SupervisorConfig } from '../rig/config.ts'
import { writeFifo } from '../rig/fifo.ts'
import { hardwarePresent } from '../rig/hardware.ts'
import { openIndiView } from '../rig/indi-view.ts'
import { createSupervisor } from '../rig/supervisor.ts'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const path = process.argv[2] ?? process.env.RIG_SUPERVISOR_CONFIG ?? join(homedir(), '.config/cria/supervisor.json')
let config: SupervisorConfig

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
