import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script with JSDoc types, not part of a TypeScript project
import { applyProfile, phd2Running, run } from '../deploy/phd2-profile.mjs'

const golden = readFileSync(join(import.meta.dirname, 'phd2/PHDGuidingV2.golden'), 'utf8')

const afterWizard = `ConfigVersion=2001
currentProfile=1
; kept as it was
[profile]

[profile/1]
name=My Equipment
ExposureDurationMs=1000

[profile/1/camera]
LastMenuChoice=None
gain=95

[Update]
enabled=1
series=2
`

function directory(): string {
  return mkdtempSync(join(tmpdir(), 'phd2-profile-'))
}

describe('applyProfile', () => {
  it('writes the whole rig profile into an empty file', () => {
    expect(applyProfile('').text).toBe(golden)
  })

  it('is a no-op the second time', () => {
    const once = applyProfile('')
    const twice = applyProfile(once.text)
    expect(twice.changed).toBe(false)
    expect(twice.text).toBe(once.text)
  })

  it('adds the rig profile beside the one PHD2 made, keeps the rest and selects it', () => {
    const result = applyProfile(afterWizard)
    expect(result.profileId).toBe(2)
    const lines = result.text.split('\n')
    expect(lines).toContain('name=My Equipment')
    expect(lines).toContain('gain=95')
    expect(lines).toContain('series=2')
    expect(lines).toContain('; kept as it was')
    expect(lines).toContain('currentProfile=2')
    expect(lines).toContain('enabled=0')
    expect(lines).toContain('LastMenuChoice=INDI Camera [ZWO CCD ASI220MM Mini]')
    expect(applyProfile(result.text).changed).toBe(false)
  })

  it('keeps what PHD2 stored under the rig profile, and sets only its own keys', () => {
    const tuned = applyProfile('').text.replace('[profile/1/indi]', '[profile/1/scope/calibration]\nxRate=0.5\n\n[profile/1/indi]').replace('INDIhost=localhost', 'INDIhost=elsewhere')
    const result = applyProfile(tuned)
    expect(result.profileId).toBe(1)
    expect(result.text).toContain('xRate=0.5')
    expect(result.text).toContain('INDIhost=localhost')
    expect(result.text).not.toContain('elsewhere')
  })

  it('keeps a ConfigVersion PHD2 already wrote', () => {
    expect(applyProfile('ConfigVersion=2002\n').text).toContain('ConfigVersion=2002')
  })

  it('puts a root key before the first group', () => {
    const text = applyProfile('[Update]\nseries=2\n').text
    expect(text.indexOf('ServerMode=1')).toBeLessThan(text.indexOf('[Update]'))
  })
})

describe('run', () => {
  const effects = (running: boolean, lines: string[]) => ({ running: () => running, now: () => new Date('2026-10-24T22:15:30.123Z'), log: (line: string) => lines.push(line) })

  it('refuses while PHD2 runs and writes nothing', () => {
    const file = join(directory(), 'cfg')
    const lines: string[] = []
    expect(run({ file, dryRun: false }, effects(true, lines))).toBe(2)
    expect(existsSync(file)).toBe(false)
    expect(lines.join('\n')).toContain('PHD2 is running')
  })

  it('creates the file when there is none', () => {
    const file = join(directory(), 'cfg')
    expect(run({ file, dryRun: false }, effects(false, []))).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(golden)
  })

  it('backs up an existing file once and does nothing the second time', () => {
    const folder = directory()
    const file = join(folder, 'cfg')
    writeFileSync(file, afterWizard)
    const lines: string[] = []
    expect(run({ file, dryRun: false }, effects(false, lines))).toBe(0)
    expect(readFileSync(join(folder, 'cfg.cria-backup-20261024T221530Z'), 'utf8')).toBe(afterWizard)
    expect(readFileSync(file, 'utf8')).toContain('name=Cria guide')
    expect(readdirSync(folder).sort()).toEqual(['cfg', 'cfg.cria-backup-20261024T221530Z'])

    const again: string[] = []
    expect(run({ file, dryRun: false }, effects(false, again))).toBe(0)
    expect(again.join('\n')).toContain('already up to date')
    expect(readdirSync(folder)).toHaveLength(2)
  })

  it('changes nothing in a dry run, even while PHD2 runs', () => {
    const file = join(directory(), 'cfg')
    expect(run({ file, dryRun: true }, effects(true, []))).toBe(0)
    expect(existsSync(file)).toBe(false)
  })
})

describe('phd2Running', () => {
  it('sees a process called phd2.bin and ignores others', () => {
    const proc = directory()
    for (const [pid, comm] of [['10', 'node'], ['abc', 'phd2'], ['20', 'xvfb-run']]) {
      mkdirSync(join(proc, pid))
      writeFileSync(join(proc, pid, 'comm'), `${comm}\n`)
    }
    expect(phd2Running(proc)).toBe(false)
    mkdirSync(join(proc, '30'))
    writeFileSync(join(proc, '30', 'comm'), 'phd2.bin\n')
    expect(phd2Running(proc)).toBe(true)
  })
})
