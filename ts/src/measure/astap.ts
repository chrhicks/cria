import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { HeaderValue } from './fits.ts'

const run = promisify(execFile)

export interface AstapSettings {
  readonly astap: string
  readonly catalog: string
  readonly workDir: string
  readonly astapLimitSeconds: number
  readonly analyseSnr: number
}

export const wcsKeys = ['CRVAL1', 'CRVAL2', 'CRPIX1', 'CRPIX2', 'CDELT1', 'CDELT2', 'CROTA1', 'CROTA2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'] as const

export type Solve =
  | { readonly solved: true; readonly raDegrees: number; readonly decDegrees: number; readonly wcs: Readonly<Record<string, number>> }
  | { readonly solved: false; readonly reason: string }

export type Stars = { readonly measured: true; readonly hfd: number; readonly count: number } | { readonly measured: false; readonly reason: string }

export interface Astap {
  readonly solve: (path: string, header: ReadonlyMap<string, HeaderValue>) => Promise<Solve>
  readonly stars: (path: string) => Promise<Stars>
}

function fields(text: string) {
  return new Map(
    text
      .split('\n')
      .map(line => line.split('='))
      .filter(parts => parts.length >= 2)
      .map(([key = '', ...rest]) => [key.trim(), rest.join('=').trim()]),
  )
}

export function readSolution(ini: string): Solve {
  const found = fields(ini)

  if (found.get('PLTSOLVD') !== 'T') return { solved: false, reason: found.get('ERROR') || found.get('WARNING') || 'no solution' }

  const wcs = Object.fromEntries(wcsKeys.map(key => [key, Number(found.get(key))]).filter(([, value]) => Number.isFinite(value)))
  const ra = wcs['CRVAL1']
  const dec = wcs['CRVAL2']

  return ra === undefined || dec === undefined ? { solved: false, reason: 'the solution has no centre' } : { solved: true, raDegrees: ra, decDegrees: dec, wcs }
}

export function readStars(stdout: string): Stars {
  const found = fields(stdout)
  const hfd = Number(found.get('HFD_MEDIAN'))
  const count = Number(found.get('STARS'))

  return Number.isFinite(hfd) && Number.isInteger(count) ? { measured: true, hfd, count } : { measured: false, reason: 'ASTAP reported no star size' }
}

export function fieldHeightDegrees(header: ReadonlyMap<string, HeaderValue>): number | undefined {
  const number = (key: string) => Number(header.get(key))
  const pixel = header.has('YPIXSZ') ? number('YPIXSZ') : number('XPIXSZ')
  const height = (number('NAXIS2') * pixel) / 1000 / number('FOCALLEN')

  return Number.isFinite(height) && height > 0 ? (2 * Math.atan(height / 2) * 180) / Math.PI : undefined
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function makeAstap(settings: AstapSettings): Astap {
  const limit = { timeout: settings.astapLimitSeconds * 1000 }

  return {
    async solve(path, header) {
      const base = join(settings.workDir, basename(path, '.fits'))
      const fieldHeight = fieldHeightDegrees(header)

      await mkdir(settings.workDir, { recursive: true })

      try {
        await run(settings.astap, ['-f', path, '-r', '180', '-fov', fieldHeight === undefined ? '0' : fieldHeight.toFixed(3), '-d', settings.catalog, '-o', base], limit).catch(async (error: unknown) => {
          if ((await readFile(`${base}.ini`, 'utf8').catch(() => undefined)) === undefined) throw error
        })

        return readSolution(await readFile(`${base}.ini`, 'utf8'))
      } catch (error) {
        return { solved: false, reason: `ASTAP failed: ${errorText(error)}` }
      } finally {
        await Promise.all(['ini', 'wcs'].map(extension => rm(`${base}.${extension}`, { force: true })))
      }
    },

    async stars(path) {
      try {
        const { stdout } = await run(settings.astap, ['-f', path, '-analyse', String(settings.analyseSnr)], limit)

        return readStars(stdout)
      } catch (error) {
        return { measured: false, reason: `ASTAP failed: ${errorText(error)}` }
      }
    },
  }
}
