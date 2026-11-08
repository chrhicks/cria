import { setTimeout as delay } from 'node:timers/promises'
import type { RigConfig } from '../rig/config.ts'
import { writeFifo } from '../rig/fifo.ts'
import { defaultRigFile, readRigFile, wireIdsOf } from '../rig/file.ts'
import { hardwarePresent } from '../rig/hardware.ts'
import { openIndiLink } from '../rig/indi-link.ts'
import { createRig } from '../rig/supervisor.ts'
import { startRecording } from '../stream/record.ts'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const log = (line: string) => console.log(line)

const path = process.argv[2] ?? defaultRigFile
let config: RigConfig

try {
  config = readRigFile(path)
} catch (error) {
  console.error(`rig: ${path}: ${errorText(error)}`)
  process.exit(2)
}

const recording = startRecording({ settings: config.stream, wireDevices: wireIdsOf(config), log })
const indi = await openIndiLink({ host: config.indiHost, port: config.indiPort, devices: config.devices.map(device => device.indiDevice), errorGapMs: config.errorGapMs, now: Date.now, warn: log, tap: recording.tap })
const rig = createRig({ config, now: Date.now, sleep: ms => delay(ms), hardwarePresent, writeFifo, indi, log })

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    log(`rig: ${signal}, stopping`)
    process.exit(0)
  })
}

void indi.closed.then(reason => {
  log(`rig: indiserver connection lost (${reason}), exiting`)
  process.exit(1)
})

async function reconcile() {
  log(`rig: reconciling ${config.devices.map(device => device.id).join(', ')} (config ${path})`)
  for (;;) {
    await rig.tick()
    await delay(config.pollMs)
  }
}

await Promise.all([reconcile(), recording.running])
