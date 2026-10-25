#!/usr/bin/env node
// phd2-profile: writes the rig's PHD2 equipment profile into PHD2's config file,
// so nobody clicks through the GUI on a headless box. Run it with PHD2 stopped:
//
//   node phd2-profile.mjs [--file ~/.PHDGuidingV2] [--dry-run]
//
// PHD2 keeps its settings with wxConfig("PHDGuidingV2"), which on Linux is an INI
// file: root keys first, then `[group/sub]` headers with `key=value` lines.
// docs/runtime.md ("PHD2 on errai") cites the PHD2 2.6.14 source for every key.
// Only the keys listed in `entries` are set. Anything
// else in the file (a calibration, a tuned algorithm, other profiles) is kept, so
// running this again after a night of guiding does not undo it. Node built-ins only;
// the core is `applyProfile`, a pure function from file text to file text.
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const profileName = 'Cria guide'

/** Written when the file has no ConfigVersion; without it PHD2 opens its modal first-run wizard. */
export const configVersion = '2001'

export const equipment = {
  indiHost: 'localhost',
  indiPort: '7624',
  camera: 'ZWO CCD ASI220MM Mini',
  mount: 'ZWO AM5',
  focalLengthMm: '150',
  pixelSizeUm: '4',
  exposureMs: '2000',
  /** The AM5's guide rate in sidereal rate, from INDI (rig-guiding spec); sets the calibration pulse. */
  guideRate: 0.5,
}

/**
 * What PHD2's profile wizard stores for calibration: a distance of 25 px (or 20 arcsec,
 * whichever is longer), and the pulse that covers it in 12 steps at declination 0,
 * rounded up to 50 ms (calstep_dialog.cpp GetCalibrationDistance, GetCalibrationStepSize;
 * profile_wizard.cpp WrapUp). Without it PHD2 starts with a 750 ms pulse.
 */
export function calibration({ focalLengthMm, pixelSizeUm, guideRate }) {
  const arcsecPerPixel = (206.265 * pixelSizeUm) / focalLengthMm
  const distancePx = Math.ceil(Math.max(25, 20 / arcsecPerPixel))
  const seconds = (distancePx * arcsecPerPixel) / (15 * guideRate)
  return { distancePx, stepMs: Math.ceil((seconds / 12) * 1000 / 50) * 50 }
}

/**
 * Every key this script owns. `ifAbsent` keeps a value PHD2 already wrote.
 * @typedef {{ group: string, key: string, value: string, ifAbsent?: true }} Entry
 * @param {number} profileId
 * @returns {Entry[]}
 */
export const entries = profileId => [
  { group: '', key: 'ConfigVersion', value: configVersion, ifAbsent: true },
  { group: '', key: 'currentProfile', value: String(profileId) },
  { group: '', key: 'ServerMode', value: '1' },
  { group: 'Update', key: 'enabled', value: '0' },
  ...profileEntries(profileId),
]

/** @param {number} profileId @returns {Entry[]} */
function profileEntries(profileId) {
  const p = `profile/${profileId}`
  const cal = calibration({ focalLengthMm: Number(equipment.focalLengthMm), pixelSizeUm: Number(equipment.pixelSizeUm), guideRate: equipment.guideRate })
  return [
    { group: p, key: 'name', value: profileName },
    { group: p, key: 'ExposureDurationMs', value: equipment.exposureMs },
    { group: `${p}/frame`, key: 'focalLength', value: equipment.focalLengthMm },
    { group: `${p}/camera`, key: 'LastMenuChoice', value: `INDI Camera [${equipment.camera}]` },
    { group: `${p}/camera`, key: 'pixelsize', value: equipment.pixelSizeUm },
    { group: `${p}/scope`, key: 'LastMenuChoice', value: `INDI Mount [${equipment.mount}]` },
    { group: `${p}/scope`, key: 'LastAuxMenuChoice', value: 'None' },
    { group: `${p}/scope`, key: 'CalibrationDuration', value: String(cal.stepMs) },
    { group: `${p}/scope`, key: 'CalibrationDistance', value: String(cal.distancePx) },
    { group: `${p}/stepguider`, key: 'LastMenuChoice', value: 'None' },
    { group: `${p}/rotator`, key: 'LastMenuChoice', value: 'None' },
    { group: `${p}/indi`, key: 'INDIhost', value: equipment.indiHost },
    { group: `${p}/indi`, key: 'INDIport', value: equipment.indiPort },
    { group: `${p}/indi`, key: 'INDIcam', value: equipment.camera },
    { group: `${p}/indi`, key: 'INDIcam_ccd', value: '0' },
    { group: `${p}/indi`, key: 'INDImount', value: equipment.mount },
    { group: `${p}/guider/multistar`, key: 'enabled', value: '1' },
  ]
}

/**
 * The file as groups of lines. `''` is the root; a group is created with its
 * parents, so `[profile/1/camera]` is always preceded by `[profile]` and `[profile/1]`.
 * @typedef {{ key: string, value: string } | { raw: string }} Line
 * @typedef {Map<string, Line[]>} Ini
 */

/** @param {string} text @returns {Ini} */
export function parseIni(text) {
  /** @type {Ini} */
  const ini = new Map([['', []]])
  let current = ''
  for (const source of text.split('\n')) {
    const line = source.trim()
    if (line === '') continue
    const header = /^\[(.*)\]$/.exec(line)
    if (header) {
      current = header[1]
      ensureGroup(ini, current)
      continue
    }
    const equals = line.indexOf('=')
    if (equals > 0 && !/^[;#]/.test(line)) {
      ini.get(current).push({ key: line.slice(0, equals).trim(), value: line.slice(equals + 1).trim() })
    } else {
      ini.get(current).push({ raw: line })
    }
  }
  return ini
}

/** @param {Ini} ini @param {string} group */
function ensureGroup(ini, group) {
  const parts = group.split('/')
  for (let depth = 1; depth <= parts.length; depth++) {
    const path = parts.slice(0, depth).join('/')
    if (!ini.has(path)) ini.set(path, [])
  }
}

/** @param {Ini} ini @returns {string} */
export function renderIni(ini) {
  const blocks = []
  for (const [group, lines] of ini) {
    const body = lines.map(line => ('raw' in line ? line.raw : `${line.key}=${line.value}`))
    blocks.push(group === '' ? body : [`[${group}]`, ...body])
  }
  return `${blocks
    .filter(block => block.length > 0)
    .map(block => block.join('\n'))
    .join('\n\n')}\n`
}

/**
 * wxFileConfig unescapes backslashes and quotes, and trims spaces, when it reads a value.
 * @param {string} value
 */
function assertPlain(value) {
  if (/[\\"\n\r]/.test(value) || value !== value.trim()) throw new Error(`phd2-profile: value ${JSON.stringify(value)} needs wxFileConfig escaping, which this script does not write`)
}

/** @param {Ini} ini */
function profileIdOf(ini) {
  let max = 0
  for (const [group, lines] of ini) {
    const match = /^profile\/(\d+)$/.exec(group)
    if (!match) continue
    max = Math.max(max, Number(match[1]))
    if (lines.some(line => 'key' in line && line.key === 'name' && line.value === profileName)) return Number(match[1])
  }
  return max + 1
}

/**
 * @param {string} text the current file, or '' when there is none
 * @returns {{ text: string, changed: boolean, profileId: number }}
 */
export function applyProfile(text) {
  const ini = parseIni(text)
  const profileId = profileIdOf(ini)
  for (const { group, key, value, ifAbsent } of entries(profileId)) {
    assertPlain(value)
    ensureGroup(ini, group)
    const lines = ini.get(group)
    const existing = lines.find(line => 'key' in line && line.key === key)
    if (!existing) lines.push({ key, value })
    else if (!ifAbsent) existing.value = value
  }
  const next = renderIni(ini)
  return { text: next, changed: next !== renderIni(parseIni(text)), profileId }
}

/** True when a process called phd2 or phd2.bin (the Arch wrapper execs phd2.bin) exists. */
export function phd2Running(procDir = '/proc') {
  for (const pid of readdirSync(procDir)) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const comm = readFileSync(join(procDir, pid, 'comm'), 'utf8').trim()
      if (comm === 'phd2' || comm === 'phd2.bin') return true
    } catch {
      // the process ended between readdir and read
    }
  }
  return false
}

/** @param {Date} date */
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/**
 * @param {{ file: string, dryRun: boolean }} options
 * @param {{ running: () => boolean, now: () => Date, log: (line: string) => void }} effects
 * @returns {number} the exit code
 */
export function run({ file, dryRun }, { running, now, log }) {
  if (!dryRun && running()) {
    log('phd2-profile: PHD2 is running; PHD2 rewrites its config when it exits, so stop it first (systemctl --user stop phd2)')
    return 2
  }
  const exists = existsSync(file)
  const result = applyProfile(exists ? readFileSync(file, 'utf8') : '')
  const label = `profile ${result.profileId} "${profileName}" in ${file}`
  if (!result.changed && exists) {
    log(`phd2-profile: ${label} is already up to date`)
    return 0
  }
  if (dryRun) {
    log(result.text.trimEnd())
    return 0
  }
  if (exists) {
    const backup = `${file}.cria-backup-${stamp(now())}`
    copyFileSync(file, backup)
    log(`phd2-profile: backed up the old file to ${backup}`)
  }
  const temporary = join(dirname(file), `.${profileName.replace(/ /g, '-')}.${process.pid}.tmp`)
  writeFileSync(temporary, result.text)
  renameSync(temporary, file)
  log(`phd2-profile: wrote ${label}`)
  return 0
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fileIndex = args.indexOf('--file')
  const file = fileIndex >= 0 ? args[fileIndex + 1] : join(homedir(), '.PHDGuidingV2')
  const unknown = args.filter((arg, index) => arg !== '--dry-run' && arg !== '--file' && !(fileIndex >= 0 && index === fileIndex + 1))
  if (!file || unknown.length > 0) {
    console.error('usage: phd2-profile.mjs [--file PATH] [--dry-run]')
    process.exit(1)
  }
  process.exit(run({ file, dryRun }, { running: () => phd2Running(), now: () => new Date(), log: line => console.log(line) }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
