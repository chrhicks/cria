#!/usr/bin/env node
/**
 * indi-replay serve <recording> [--port N] [--camera NAME] [--from K] [--to K] [--faults faults.json]
 * indi-replay synthesize <spec.json> <folder>
 *
 * `serve` listens on the loopback interface and prints `listening on 127.0.0.1:<port>`
 * once it does. It stops on SIGINT and SIGTERM. Neither command touches
 * hardware: replay is a server over files.
 */
import { readFile } from 'node:fs/promises'
import { decodeFaults } from './faults.js'
import { startReplay } from './replay.js'
import { synthesizeTape, type SynthSpec } from './synthesize.js'
import { loadTape } from './tape.js'

const usage = `usage:
  indi-replay serve <recording> [--port N] [--camera NAME] [--from K] [--to K] [--faults faults.json]
  indi-replay synthesize <spec.json> <folder>`

function flags(args: ReadonlyArray<string>): { positional: string[]; named: Map<string, string> } {
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

const integer = (named: Map<string, string>, name: string): number | undefined => {
  const text = named.get(name)

  if (text === undefined) return undefined
  if (!/^\d+$/.test(text)) throw new Error(`--${name} needs a whole number, not ${text}`)

  return Number(text)
}

async function serve(args: ReadonlyArray<string>) {
  const { positional, named } = flags(args)

  if (positional.length !== 1) throw new Error(usage)
  const camera = named.get('camera')
  const port = integer(named, 'port')
  const fromFrame = integer(named, 'from')
  const toFrame = integer(named, 'to')
  const faults = named.has('faults') ? decodeFaults(JSON.parse(await readFile(named.get('faults')!, 'utf8'))) : []
  const tape = await loadTape(positional[0]!, camera === undefined ? {} : { camera })
  const replay = await startReplay(tape, {
    ...(port === undefined ? {} : { port }),
    ...(fromFrame === undefined ? {} : { fromFrame }),
    ...(toFrame === undefined ? {} : { toFrame }),
    faults,
    log: line => console.error(line),
  })

  console.log(`listening on 127.0.0.1:${replay.port}`)
  console.error(`serving ${tape.frames.length} frames of ${tape.camera} from ${tape.directory}`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void replay.stop().then(() => process.exit(0)))
}

async function synthesize(args: ReadonlyArray<string>) {
  const { positional } = flags(args)

  if (positional.length !== 2) throw new Error(usage)
  const spec = JSON.parse(await readFile(positional[0]!, 'utf8')) as SynthSpec

  console.log(await synthesizeTape(spec, positional[1]!))
}

const [command, ...rest] = process.argv.slice(2)

try {
  if (command === 'serve') await serve(rest)
  else if (command === 'synthesize') await synthesize(rest)
  else throw new Error(usage)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
