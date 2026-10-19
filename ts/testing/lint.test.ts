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
  'packages/primitives/src/outcome.ts': { 'catch-all': [1, 'settle: the one place an ending becomes a value'] },
  'packages/primitives/src/run.ts': {
    'catch-all': [1, 'records the outcome from the body exit'],
    'wall-clock': [2, 'startedAt and settledAt are wire timestamps'],
  },
  'packages/primitives/src/discipline/stoppable.ts': { 'catch-all': [4, 'classifies start, settle and stop endings'] },
  'packages/primitives/src/discipline/confirm.ts': { 'catch-all': [1, 'a failed read is retried; reads only'] },
  'packages/primitives/src/discipline/retry-reads.ts': {
    'catch-all': [1, 'a failed read is reported as stale'],
    'wall-clock': [1, "a read's startedAt is compared with INDI receive times, which are wall-clock"],
  },
  'packages/indi/src/client.ts': {
    'try-catch': [1, 'a frame the parser rejects closes the socket from inside a Node data handler'],
    'wall-clock': [5, 'receive times and connection status times; the reconnect backoff resets after 10 s connected'],
  },
  'packages/recording/src/reader.ts': {
    'try-catch': [2, 'a line that is not JSON, and a manifest that cannot be read, are reported as damage, not thrown'],
  },
  'packages/recording/src/recorder.ts': {
    'try-catch': [4, 'a failed write, a bug building an entry, a failed close and a manifest that cannot be written each stop recording and never reach Cria or the socket'],
    'wall-clock': [1, 'a recorded line carries its wall-clock time'],
  },
  'apps/cria/src/recording.ts': { 'catch-all': [1, 'a recording that cannot open is logged and Cria runs without it'] },
  'apps/cria/src/rig.ts': { 'catch-all': [1, 'a refused start-up connect is logged; it ran nothing'] },
  'apps/cria/src/capability/commands.ts': { 'catch-all': [1, 'notACommand: BLOB routing, not a physical command'] },
  'apps/cria/src/capability/camera.ts': {
    'try-catch': [1, 'an unreadable FITS header means the frame is not ours, in a plain function'],
    'wall-clock': [3, 'dispatch time compared with the driver-stamped DATE-OBS; elapsed progress; commandedAt on the wire'],
  },
  'apps/cria/src/capability/fields.ts': { 'wall-clock': [1, 'takenAt compared with receive times, which are wall-clock'] },
  'apps/cria/src/capability/liveness.ts': { 'wall-clock': [2, 'connectedSince and definedAt, compared with takenAt'] },
  'apps/cria/src/capability/mount.ts': { 'wall-clock': [1, 'sidereal time is a function of real time'] },
  'apps/cria/src/image/store.ts': {
    'try-catch': [1, 'removes the partial file, then rethrows into Effect.tryPromise'],
    'wall-clock': [1, 'retainedAt is a wire timestamp'],
  },
  'apps/cria/src/operation/ledger.ts': { 'wall-clock': [5, 'admission, settle and recovery times are wire timestamps'] },
  'apps/cria/src/wire/project.ts': { 'wall-clock': [1, 'generatedAt is a wire timestamp'] },
  'apps/cria/src/wire/http.ts': {
    'try-catch': [1, 'a body that is not JSON is refused as request-error'],
    'promise-catch': [3, "the Node request handler's boundary; an image that cannot be opened is gone; closing after a download reports nothing"],
  },
  'apps/cria/src/wire/sse.ts': {
    'try-catch': [1, 'a snapshot that cannot be built ends the stream'],
    'wall-clock': [2, 'the stream is paced on Node timers outside Effect (faked in sse.test.ts)'],
    'node-timer': [1, 'the stream is paced on Node timers outside Effect (faked in sse.test.ts)'],
  },
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
        'apps/cria/src/wire/project.ts': 'const generatedAt = 0',
      }),
    ).toEqual([
      'apps/cria/src/new.ts: catch-all found 1, allowed 0',
      'apps/cria/src/new.ts: try-catch found 1, allowed 0',
      'apps/cria/src/new.ts: promise-catch found 1, allowed 0',
      'apps/cria/src/new.ts: wall-clock found 1, allowed 0',
      'apps/cria/src/new.ts: node-timer found 1, allowed 0',
      'apps/cria/src/wire/project.ts: wall-clock found 0, allowed 1',
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
