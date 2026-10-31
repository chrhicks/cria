#!/usr/bin/env node
/**
 * fake-rig list
 * fake-rig serve <scenario> [--host H] [--port N] [--acknowledge-ms N]
 *
 * `serve` starts a fake errai rig (both cameras, the EAF, the AM5 and the Pegasus box on a fake
 * INDI server) with one recorded or derived failure, and the real Cria on it, listening on
 * <host>:<port> (default 127.0.0.1:4320). A test Vela pointed at that address meets the failure
 * when it sends the command the scenario names. CRIA_TOKEN, when set, is the bearer token Cria
 * asks for. Stops on SIGINT and SIGTERM. Nothing here touches hardware or errai.
 */
import { scenarioNamed, scenarios, startRig } from '../apps/cria/test/rig-scenarios.js'

const usage = `usage:
  fake-rig list
  fake-rig serve <scenario> [--host H] [--port N] [--acknowledge-ms N]
scenarios: ${scenarios.map(scenario => scenario.name).join(', ')}`

const [command, ...rest] = process.argv.slice(2)

function list() {
  for (const scenario of scenarios) {
    console.log(`${scenario.name} (${scenario.source})`)
    console.log(`  from:   ${scenario.episode}`)
    console.log(`  try:    ${scenario.tryThis}`)
    console.log(`  expect: ${scenario.expect}`)
  }
}

function options(args: ReadonlyArray<string>) {
  const positional: string[] = []
  const named = new Map<string, string>()

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!

    if (!arg.startsWith('--')) positional.push(arg)
    else {
      const value = args[++index]

      if (value === undefined) throw new Error(`${arg} needs a value\n${usage}`)
      named.set(arg.slice(2), value)
    }
  }

  return { positional, named }
}

const whole = (named: Map<string, string>, name: string): number | undefined => {
  const text = named.get(name)

  if (text === undefined) return undefined
  if (!/^\d+$/.test(text)) throw new Error(`--${name} needs a whole number, not ${text}`)

  return Number(text)
}

async function serve(args: ReadonlyArray<string>) {
  const { positional, named } = options(args)
  const scenario = positional.length === 1 ? scenarioNamed(positional[0]!) : undefined

  if (!scenario) throw new Error(usage)
  const host = named.get('host') ?? '127.0.0.1'
  const port = whole(named, 'port') ?? 4320
  const acknowledgeMs = whole(named, 'acknowledge-ms')
  const token = process.env.CRIA_TOKEN
  const rig = await startRig(scenario, { host, port, ...(acknowledgeMs === undefined ? {} : { acknowledgeMs }), ...(token ? { token } : {}) })

  console.log(`scenario ${scenario.name} (${scenario.source}): ${scenario.episode}`)
  console.log(`try:    ${scenario.tryThis}`)
  console.log(`expect: ${scenario.expect}`)
  console.log(`listening on http://${host}:${rig.cria.service.port}`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void rig.stop().then(() => process.exit(0)))
}

try {
  if (command === 'list') list()
  else if (command === 'serve') await serve(rest)
  else throw new Error(usage)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
