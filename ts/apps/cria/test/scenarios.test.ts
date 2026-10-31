/**
 * Every scenario of `pnpm fake-rig` (rig-scenarios.ts), run against the real Cria with the commands
 * the scenario names: what Vela is told (kind, reason) and whether the device is held. The same
 * scenarios are what a person serves to a test Vela, so what `fake-rig list` promises is tested here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scenarios, startRig } from './rig-scenarios.js'
import { allReady } from './harness.js'

let stop: (() => Promise<void>) | undefined

afterEach(async () => {
  await stop?.()
  stop = undefined
})

describe('the fake-rig scenarios', () => {
  it('lists each scenario once, with its source', () => {
    expect(scenarios.map(scenario => [scenario.name, scenario.source])).toEqual([
      ['camera-silent', 'derived'],
      ['focuser-short', 'derived'],
      ['focuser-silent', 'derived'],
      ['switch-ignored', 'derived'],
      ['weather-silent', 'derived'],
      ['guide-loop', 'recorded'],
      ['mount-home-stop', 'recorded'],
      ['mount-power-cut', 'recorded'],
      ['mount-pole-rotate', 'recorded'],
    ])
  })

  it('documents each scenario in docs/testing.md, with its source', () => {
    const docs = readFileSync(join(import.meta.dirname, '../../../../docs/testing.md'), 'utf8')

    for (const scenario of scenarios) expect(docs).toContain(`| \`${scenario.name}\` | ${scenario.source} |`)
  })

  for (const scenario of scenarios) {
    it(`${scenario.name} (${scenario.source}): ${scenario.outcome.device} ends ${scenario.outcome.kind}${scenario.outcome.reason ? ` ${scenario.outcome.reason}` : ''}, ${scenario.outcome.held ? 'held' : 'not held'}`, async () => {
      const rig = await startRig(scenario, { acknowledgeMs: 600 })

      stop = rig.stop
      await rig.cria.waitFor(allReady(scenario.boxDisconnected ? ['primary', 'guide', 'focuser', 'mount'] : ['primary', 'guide', 'focuser', 'mount', 'weather', 'switch']))
      const ending = await scenario.drive(rig)
      const device = await rig.cria.device(scenario.outcome.device)

      expect([ending.kind, ending.reason]).toEqual([scenario.outcome.kind, scenario.outcome.reason])
      expect(device.quarantine.held).toBe(scenario.outcome.held)
      if (scenario.outcome.message !== undefined) expect(ending.message).toBe(scenario.outcome.message)
    }, 90_000)
  }
})
