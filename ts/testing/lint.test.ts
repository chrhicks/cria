import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

const rules = {
  'catch-all': /Effect\.(catch|catchCause|catchDefect|ignore|ignoreCause|orElseSucceed|catchIf|catchFilter|option|exit|result)\b/g,
  'try-catch': /\btry\s*\{/g,
  'promise-catch': /\.catch\(/g,
  'wall-clock': /Date\.now\(\)/g,
  'node-timer': /\bset(Timeout|Interval)\(/g,
}

type Rule = keyof typeof rules

const allowed: Record<string, Partial<Record<Rule, readonly [count: number, why: string]>>> = {
  'src/indi/client.ts': {
    'try-catch': [1, 'a bug in applying a message closes the socket from inside a Node data handler'],
    'wall-clock': [4, 'connection status times; the reconnect backoff resets after 10 s connected'],
  },
  'src/indi/xml.ts': {
    'try-catch': [2, 'an IndiProtocolError from one element or from the framing becomes a problem the client logs, never a throw out of a data handler'],
  },
  'src/stream/publisher.ts': {
    'try-catch': [3, 'a refused login is logged and tried again, a plain publish the broker refuses is logged and skipped, and an entry the stream has not stored is sent again: whatever publishes must never stop for it'],
    'node-timer': [1, 'the wait before logging in or storing again, cut short when the connection returns or the publisher closes'],
  },
  'src/recorder/recorder.ts': {
    'wall-clock': [1, 'an entry with no time of its own is stamped when the client saw it'],
  },
  'src/rig/fifo.ts': { 'try-catch': [1, 'the FIFO handle is closed whether or not the write succeeded'] },
  'src/rig/hardware.ts': { 'try-catch': [2, 'a USB device sysfs cannot be read, or a sysfs that is not there, is a device that is not attached'] },
  'src/rig/supervisor.ts': {
    'try-catch': [2, 'a write INDI refuses and a FIFO that cannot be written are logged and tried again on a later poll: one failure must not stop the rig program'],
  },
  'src/bin/rig.ts': { 'try-catch': [2, 'a config file that cannot be read exits 2, and a poll that throws is logged and the next poll runs: the rig program must keep watching'] },
  'src/viewer/viewer.ts': { 'promise-catch': [1, 'a page whose stream fails is logged and closed, and its browser reconnects'] },
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
        'src/rig/new.ts': 'Effect.ignore(x); try { y() } catch {}; p.catch(() => 0); Date.now(); setTimeout(f, 1)',
        'src/recorder/recorder.ts': 'const stamp = 0',
      }),
    ).toEqual([
      'src/rig/new.ts: catch-all found 1, allowed 0',
      'src/rig/new.ts: try-catch found 1, allowed 0',
      'src/rig/new.ts: promise-catch found 1, allowed 0',
      'src/rig/new.ts: wall-clock found 1, allowed 0',
      'src/rig/new.ts: node-timer found 1, allowed 0',
      'src/recorder/recorder.ts: wall-clock found 0, allowed 1',
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
