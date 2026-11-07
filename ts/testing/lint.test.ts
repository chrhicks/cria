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
  'packages/fake-indi/src/server.ts': { 'promise-catch': [1, 'a write to a client that closed mid-image must not stop the writes queued behind it'] },
  'packages/indi/src/client.ts': {
    'try-catch': [1, 'a bug in applying a message closes the socket from inside a Node data handler'],
    'wall-clock': [6, 'receive times and connection status times; the reconnect backoff resets after 10 s connected; the receive time of a forgotten property'],
  },
  'packages/indi/src/xml.ts': {
    'try-catch': [2, 'an IndiProtocolError from one element or from the framing becomes a problem the client logs, never a throw out of a data handler'],
  },
  'packages/stream/src/publisher.ts': {
    'try-catch': [2, 'a message the broker refuses is logged and skipped, and an unconfirmed one is sent again once it returns: whatever publishes must never stop for it'],
    'promise-catch': [1, 'a broker that refuses the login is logged: Cria still has to run without it'],
  },
  'apps/cria/src/stream.ts': {
    'catch-all': [1, 'stream settings that cannot be read are logged and Cria runs without publishing'],
    'wall-clock': [1, 'an entry is stamped when Cria made it'],
  },
  'apps/rig-stream/src/client.ts': {
    'wall-clock': [1, 'an entry with no time of its own is stamped when the client saw it'],
  },
  'apps/rig-stream/src/viewer.ts': { 'promise-catch': [1, 'a page whose stream fails is logged and closed, and its browser reconnects'] },
}

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(path)

    return path.includes('/src/') && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
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
      [...sources(join(root, 'packages')), ...sources(join(root, 'apps'))].map(path => [relative(root, path), readFileSync(path, 'utf8')]),
    )

    expect(Object.keys(allowed).filter(path => !(path in files))).toEqual([])
    expect(lint(files)).toEqual([])
  })

  it('reports a new site and a stale allowance', () => {
    expect(
      lint({
        'apps/cria/src/new.ts': 'Effect.ignore(x); try { y() } catch {}; p.catch(() => 0); Date.now(); setTimeout(f, 1)',
        'apps/rig-stream/src/client.ts': 'const stamp = 0',
      }),
    ).toEqual([
      'apps/cria/src/new.ts: catch-all found 1, allowed 0',
      'apps/cria/src/new.ts: try-catch found 1, allowed 0',
      'apps/cria/src/new.ts: promise-catch found 1, allowed 0',
      'apps/cria/src/new.ts: wall-clock found 1, allowed 0',
      'apps/cria/src/new.ts: node-timer found 1, allowed 0',
      'apps/rig-stream/src/client.ts: wall-clock found 0, allowed 1',
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
