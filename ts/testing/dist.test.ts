/**
 * The shared packages commit their build (`dist/`): Vela installs them as git
 * subfolder dependencies, which get no build step. This fails when a source
 * change was committed without rebuilding: run `pnpm build` and commit `dist/`.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const tsc = join(root, 'node_modules', '.bin', 'tsc')

function files(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .sort()
}

describe('committed dist', () => {
  for (const name of ['primitives', 'cria-wire', 'fits']) {
    it(`${name}: dist/ matches a fresh build of src/`, () => {
      const packageDirectory = join(root, 'packages', name)
      // A sibling directory keeps the source-map paths ("../src/...") identical.
      const fresh = join(packageDirectory, '.dist-check')

      try {
        execFileSync(tsc, ['-p', join(packageDirectory, 'tsconfig.json'), '--outDir', fresh])
        const committed = join(packageDirectory, 'dist')

        expect(files(fresh)).toEqual(files(committed))
        for (const file of files(fresh)) expect(readFileSync(join(fresh, file), 'utf8'), file).toBe(readFileSync(join(committed, file), 'utf8'))
      } finally {
        rmSync(fresh, { recursive: true, force: true })
      }
    }, 60_000)
  }
})
