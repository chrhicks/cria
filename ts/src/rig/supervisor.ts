import type { RigConfig, RigDevice } from './config.ts'
import type { IndiLink } from './indi-link.ts'
import { decide, emptyMemory, markUnsent, type Action } from './reconcile.ts'

interface RigDependencies {
  readonly config: RigConfig
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly hardwarePresent: (device: RigDevice) => boolean | Promise<boolean>
  readonly writeFifo: (path: string, line: string) => Promise<void>
  readonly indi: Pick<IndiLink, 'view' | 'write'>
  readonly log: (line: string) => void
}

export interface Rig {
  readonly tick: () => Promise<void>
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createRig(dependencies: RigDependencies): Rig {
  const { config, now, sleep, log, indi } = dependencies
  let memory = emptyMemory(config)
  let lastFifoWrite = Number.NEGATIVE_INFINITY

  async function fifoLine(line: string) {
    const wait = lastFifoWrite + config.fifoGapMs - now()

    if (wait > 0) await sleep(wait)
    lastFifoWrite = now()
    await dependencies.writeFifo(config.fifo, line)
  }

  async function perform(action: Action) {
    switch (action.kind) {
      case 'log':
        log(action.line)

        return
      case 'write':
        log(`rig: ${action.device}: writing ${action.property} (${Object.keys(action.values).join(', ')}): ${action.why}`)
        try {
          await indi.write(action.indiDevice, action.property, action.values)
        } catch (error) {
          log(`rig: ${action.device}: ${action.property} not sent: ${errorText(error)}`)
          markUnsent(memory, action)
        }

        return
      case 'restart-driver':
        log(`rig: ${action.driver}: restarting (${action.why})`)
        try {
          await fifoLine(`stop ${action.driver}`)
          await fifoLine(`start ${action.driver}`)
        } catch (error) {
          log(`rig: ${action.driver}: FIFO write failed: ${errorText(error)}`)
        }
    }
  }

  async function tick() {
    const snapshot = indi.view()
    const hardware: Record<string, boolean> = {}

    for (const device of config.devices) hardware[device.id] = await dependencies.hardwarePresent(device)

    const decision = decide(config, { now: now(), snapshot, hardware }, memory)

    memory = decision.memory
    for (const action of decision.actions) await perform(action)
  }

  return { tick }
}
