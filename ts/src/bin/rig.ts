import { setTimeout as delay } from 'node:timers/promises'
import { makeAstap } from '../measure/astap.ts'
import { readHeader } from '../measure/fits.ts'
import { createMeasure, fileExists, followMeasure, removeFile, type MeasureAnswer } from '../measure/measure.ts'
import { createCommands, followCommands } from '../rig/commands.ts'
import type { RigConfig } from '../rig/config.ts'
import { writeFifo } from '../rig/fifo.ts'
import { defaultRigFile, readRigFile, wireIdsOf } from '../rig/file.ts'
import { hardwarePresent } from '../rig/hardware.ts'
import { openIndiLink } from '../rig/indi-link.ts'
import { createRig } from '../rig/supervisor.ts'
import { startRecording } from '../stream/record.ts'
import { errorText, stateLog, tryingAgain } from '../stream/retry.ts'

const log = (line: string) => console.log(line)

const path = process.argv[2] ?? defaultRigFile
let config: RigConfig

try {
  config = readRigFile(path)
} catch (error) {
  console.error(`rig: ${path}: ${errorText(error)}`)
  process.exit(2)
}

let askIndiForEverything = () => {}
const recording = startRecording({ settings: config.stream, wireDevices: wireIdsOf(config), log, onBrokerConnected: () => askIndiForEverything() })
const indi = await openIndiLink({ host: config.indiHost, port: config.indiPort, devices: config.devices.map(device => device.indiDevice), errorGapMs: config.errorGapMs, now: Date.now, warn: log, tap: recording.tap })
askIndiForEverything = indi.askAll
const rig = createRig({ config, now: Date.now, sleep: ms => delay(ms), hardwarePresent, writeFifo, indi, log })
const commands = createCommands({ config, indi, answer: answer => recording.client('command', answer), log })
const measuring = config.measure
const measure = createMeasure({
  folder: measuring?.folder,
  astap: measuring === undefined ? undefined : makeAstap(measuring),
  readHeader,
  store: (answer: MeasureAnswer) => recording.storeClient('measure', answer),
  answer: (answer: MeasureAnswer) => recording.client('measure', answer),
  remove: removeFile,
  exists: fileExists,
  now: Date.now,
  log,
})

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
  const failures = stateLog('rig', log, tryingAgain(config.pollMs))

  for (;;) {
    try {
      await rig.tick()
      failures.healthy()
    } catch (error) {
      failures.failed(error)
    }
    await delay(config.pollMs)
  }
}

await Promise.all([reconcile(), recording.running, followCommands({ settings: config.stream, devices: config.devices.map(device => device.id), commands, log }), followMeasure({ settings: config.stream, measure, log })])
