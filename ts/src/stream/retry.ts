import { setTimeout as delay } from 'node:timers/promises'

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const tryingAgain = (retryMs: number) => `trying again every ${retryMs / 1000} s`

export function stateLog(name: string, log: (line: string) => void, consequence: string) {
  let failure: string | undefined

  return {
    failed(error: unknown) {
      const text = errorText(error)

      if (text === failure) return
      failure = text
      log(`${name}: ${text}; ${consequence}`)
    },
    healthy() {
      if (failure === undefined) return
      failure = undefined
      log(`${name}: working again`)
    },
  }
}

export async function keepRunning(options: {
  readonly name: string
  readonly retryMs: number
  readonly log: (line: string) => void
  readonly run: (healthy: () => void) => Promise<unknown>
  readonly sleep?: (ms: number) => Promise<unknown>
  readonly signal?: AbortSignal
}): Promise<void> {
  const { name, retryMs, log, run, sleep = delay, signal } = options
  const state = stateLog(name, log, tryingAgain(retryMs))

  while (!signal?.aborted) {
    try {
      await run(state.healthy)
      state.failed(new Error('stopped'))
    } catch (error) {
      state.failed(error)
    }
    await sleep(retryMs)
  }
}
