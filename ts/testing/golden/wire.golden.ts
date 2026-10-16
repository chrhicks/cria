import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { diff, failedStep, normalize, type Entry } from './golden.js'
import { runScenario, scenarios } from './scenarios.js'

const file = join(import.meta.dirname, 'wire.golden.json')

it('protocol 5 wire matches the golden', async () => {
  const actual: Entry[] = []

  for (const scenario of scenarios) actual.push(...normalize(scenario.name, await runScenario(scenario)))

  if (process.env.GOLDEN_UPDATE === '1') {
    const failed = actual.filter(entry => entry.request === failedStep)

    if (failed.length > 0) throw new Error(`Not updating the golden: ${failed.map(entry => `${entry.scenario}: ${String(entry.body)}`).join('\n')}`)
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`)

    return
  }

  const report = diff(JSON.parse(readFileSync(file, 'utf8')) as Entry[], actual)

  if (report.length > 0)
    throw new Error(`The wire differs from testing/golden/wire.golden.json (pnpm golden:update only for a reviewed wire change):\n${report.join('\n')}`)
})
