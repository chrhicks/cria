import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseConfig, type RigConfig } from '../rig/config.ts'
import { writeFifo } from '../rig/fifo.ts'
import { hardwarePresent } from '../rig/hardware.ts'
import { openIndiLink } from '../rig/indi-link.ts'
import { createRig } from '../rig/supervisor.ts'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const path = process.argv[2] ?? join(homedir(), '.config/cria/rig.json')
let config: RigConfig

try {
  config = parseConfig(JSON.parse(readFileSync(path, 'utf8')), { runtimeDir: process.env.XDG_RUNTIME_DIR })
} catch (error) {
  console.error(`rig: ${path}: ${errorText(error)}`)
  process.exit(2)
}

const indi = await openIndiLink({ host: config.indiHost, port: config.indiPort, devices: config.devices.map(device => device.indiDevice), errorGapMs: config.errorGapMs, now: Date.now })
const rig = createRig({ config, now: Date.now, sleep: ms => delay(ms), hardwarePresent, writeFifo, indi, log: line => console.log(line) })
let running = true

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    console.log(`rig: ${signal}, stopping`)
    running = false
    void indi.close().finally(() => process.exit(0))
  })
}

console.log(`rig: reconciling ${config.devices.map(device => device.id).join(', ')} (config ${path})`)
while (running) {
  try {
    await rig.tick()
  } catch (error) {
    console.log(`rig: poll failed: ${error instanceof Error ? error.stack : String(error)}`)
  }
  await delay(config.pollMs)
}
