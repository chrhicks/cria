import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

const rules = {
  'try-catch': /\btry\s*\{/g,
  'promise-catch': /\.catch\(/g,
}

type Rule = keyof typeof rules

const allowed: Record<string, Partial<Record<Rule, readonly [count: number, why: string]>>> = {
  'src/indi/xml.ts': {
    'try-catch': [1, 'an IndiProtocolError from one element becomes a problem the client logs and records, never a throw out of a data handler'],
  },
  'src/stream/json.ts': { 'try-catch': [1, 'a line that is not JSON is kept as text'] },
  'src/stream/journal.ts': { 'try-catch': [1, 'a try with only a finally: journalctl is stopped, and a cursor it could not use is forgotten, however the follower ends'] },
  'src/stream/retry.ts': { 'try-catch': [1, 'a source that throws is logged once and run again after the retry delay'] },
  'src/stream/publisher.ts': {
    'try-catch': [3, 'a broker that cannot be reached or an entry it will not take is logged once and tried again (stored entries) or dropped (live entries), never a throw into the INDI socket or the journal follower'],
  },
  'src/rig/commands.ts': {
    'try-catch': [1, 'a write INDI refuses is answered as refused with its reason and the next command is still written'],
  },
  'src/rig/hardware.ts': { 'try-catch': [2, 'a USB device sysfs cannot be read, or a sysfs that is not there, is a device that is not attached'] },
  'src/rig/supervisor.ts': {
    'try-catch': [2, 'a write INDI refuses and a FIFO that cannot be written are logged and tried again on a later poll: one failure must not stop the rig program'],
  },
  'src/bin/rig.ts': {
    'try-catch': [2, 'a config file that cannot be read exits 2, which systemd does not restart; a poll that throws is logged once and tried again on the next poll, so the devices keep their upkeep'],
  },
  'src/viewer/viewer.ts': {
    'promise-catch': [2, 'a page whose stream fails is logged and closed, and its browser reconnects; a highlights request that fails (a body cut off, a file that cannot be written) is logged and answered with the error, or closed when the answer had begun'],
  },
}

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(path)

    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

function lint(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([path, text]) =>
    Object.entries(rules).flatMap(([rule, pattern]) => {
      const found = text.match(pattern)?.length ?? 0
      const permitted = allowed[path]?.[rule as Rule]?.[0] ?? 0

      return found === permitted ? [] : [`${path}: ${rule} found ${found}, allowed ${permitted}`]
    }),
  )
}

describe('source rules', () => {
  it('finds each rule only at its allowlisted sites, and every allowlisted site still there', () => {
    const files = Object.fromEntries(
      [...sources(join(root, 'src')), ...sources(join(root, 'testing', 'fake-indi'))].map(path => [relative(root, path), readFileSync(path, 'utf8')]),
    )

    expect(Object.keys(allowed).filter(path => !(path in files))).toEqual([])
    expect(lint(files)).toEqual([])
  })

  it('reports a new site and a stale allowance', () => {
    expect(
      lint({
        'src/rig/new.ts': 'try { y() } catch {}; p.catch(() => 0)',
        'src/stream/json.ts': 'const parsed = 0',
      }),
    ).toEqual([
      'src/rig/new.ts: try-catch found 1, allowed 0',
      'src/rig/new.ts: promise-catch found 1, allowed 0',
      'src/stream/json.ts: try-catch found 0, allowed 1',
    ])
  })
})

const pipes = (lines: ReadonlyArray<string>) => lines.filter(line => /(^|[^|])\|([^|]|$)/.test(line))

describe('verify.sh', () => {
  const script = readFileSync(join(root, 'verify.sh'), 'utf8').split('\n')

  it('stops on the first error, unset variable or failed pipe', () => {
    expect(script.slice(0, 2)).toEqual(['#!/usr/bin/env bash', 'set -euo pipefail'])
  })

  it('pipes nothing: a pipe once reported a failing suite as passing', () => {
    expect(pipes(script)).toEqual([])
    expect(pipes(['  "$@" || status=$?', 'stage tests pnpm test | tee test.log'])).toEqual(['stage tests pnpm test | tee test.log'])
  })
})
