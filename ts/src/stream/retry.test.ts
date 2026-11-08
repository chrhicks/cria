import { describe, expect, it } from 'vitest'
import { keepRunning, stateLog, tryingAgain } from './retry.ts'

describe('state log', () => {
  it('says a failure once, however often it repeats, and says when it is over', () => {
    const lines: string[] = []
    const state = stateLog('journal', line => lines.push(line), tryingAgain(5000))

    state.healthy()
    state.failed(new Error('journalctl stopped (exit 1)'))
    state.failed(new Error('journalctl stopped (exit 1)'))
    state.failed(new Error('no responders'))
    state.healthy()
    state.healthy()
    state.failed(new Error('no responders'))

    expect(lines).toEqual([
      'journal: journalctl stopped (exit 1); trying again every 5 s',
      'journal: no responders; trying again every 5 s',
      'journal: working again',
      'journal: no responders; trying again every 5 s',
    ])
  })
})

describe('keeping a source running', () => {
  it('runs it again after it fails or ends, waiting between tries, and logs the failure once', async () => {
    const lines: string[] = []
    const waits: number[] = []
    const stop = new AbortController()
    let runs = 0

    await keepRunning({
      name: 'journal',
      retryMs: 7000,
      log: line => lines.push(line),
      sleep: ms => {
        waits.push(ms)
        if (waits.length === 4) stop.abort()

        return Promise.resolve()
      },
      signal: stop.signal,
      run: async healthy => {
        runs += 1
        if (runs !== 3) throw new Error('boom')
        healthy()
      },
    })

    expect(runs).toBe(4)
    expect(waits).toEqual([7000, 7000, 7000, 7000])
    expect(lines).toEqual([
      'journal: boom; trying again every 7 s',
      'journal: working again',
      'journal: stopped; trying again every 7 s',
      'journal: boom; trying again every 7 s',
    ])
  })
})
