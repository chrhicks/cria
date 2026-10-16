#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [file, search, replace, ...tests] = process.argv.slice(2)

if (!file || search === undefined || replace === undefined || tests.length === 0) {
  console.error('usage: node testing/mutate.mjs <file> <search> <replace> <test file>...')
  process.exit(2)
}

const original = readFileSync(file, 'utf8')

if (original.split(search).length !== 2) {
  console.error(`mutate: ${JSON.stringify(search)} must occur exactly once in ${file}`)
  process.exit(2)
}

writeFileSync(file, original.replace(search, () => replace))

let result

try {
  result = spawnSync('pnpm', ['exec', 'vitest', 'run', ...tests], { encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL' })
} finally {
  writeFileSync(file, original)
}

const output = `${result.stdout}${result.stderr}`
const failures = output.split('\n').filter(line => /^\s+(×|FAIL )|AssertionError|Tests\s+\d/.test(line))

console.log(`mutant: ${file}: ${JSON.stringify(search)} -> ${JSON.stringify(replace)}`)
console.log(failures.join('\n'))
if (result.error) console.log(`tests did not finish: ${result.error.message}`)

if (result.status === 0) {
  console.log('SURVIVED: the tests passed with the behaviour broken')
  process.exit(1)
}

console.log('killed')
