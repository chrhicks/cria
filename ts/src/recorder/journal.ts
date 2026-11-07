import { spawn } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { Option, Schema } from 'effect'

const JournalEntry = Schema.fromJsonString(
  Schema.Struct({
    __CURSOR: Schema.optionalKey(Schema.String),
    SYSLOG_IDENTIFIER: Schema.optionalKey(Schema.String),
    UNIT: Schema.optionalKey(Schema.String),
    _SYSTEMD_UNIT: Schema.optionalKey(Schema.String),
    _SYSTEMD_USER_UNIT: Schema.optionalKey(Schema.String),
  }),
)

const decodeEntry = Schema.decodeUnknownOption(JournalEntry)

interface JournalExclusions {
  readonly identifiers: ReadonlyArray<string>
  readonly unitPrefixes: ReadonlyArray<string>
}

function isExcluded(line: string, exclusions: JournalExclusions) {
  const entry = decodeEntry(line)

  if (Option.isNone(entry)) return false

  const { SYSLOG_IDENTIFIER, UNIT, _SYSTEMD_UNIT, _SYSTEMD_USER_UNIT } = entry.value
  const units = [UNIT, _SYSTEMD_UNIT, _SYSTEMD_USER_UNIT]

  return (
    (SYSLOG_IDENTIFIER !== undefined && exclusions.identifiers.includes(SYSLOG_IDENTIFIER)) ||
    units.some(unit => unit !== undefined && exclusions.unitPrefixes.some(prefix => unit.startsWith(prefix)))
  )
}

export function readCursor(file: string) {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

export function saveCursor(file: string, cursor: string) {
  const next = `${file}.next`

  mkdirSync(dirname(file), { recursive: true })
  const handle = openSync(next, 'w')
  writeSync(handle, cursor)
  fsyncSync(handle)
  closeSync(handle)
  renameSync(next, file)
}

export function journalArguments(cursor: string | undefined) {
  return ['--follow', cursor === undefined ? '--lines=0' : `--after-cursor=${cursor}`, '--output=json']
}

export async function followJournal(
  exclusions: JournalExclusions,
  cursorFile: string,
  publish: (line: string) => Promise<void>,
  journalctl = 'journalctl',
) {
  const journal = spawn(journalctl, journalArguments(readCursor(cursorFile)), { stdio: ['ignore', 'pipe', 'inherit'] })
  let linesRead = 0

  for await (const line of createInterface({ input: journal.stdout })) {
    linesRead += 1
    if (!isExcluded(line, exclusions)) await publish(line)

    const entry = decodeEntry(line)

    if (Option.isSome(entry) && entry.value.__CURSOR !== undefined) saveCursor(cursorFile, entry.value.__CURSOR)
  }

  if (linesRead === 0) rmSync(cursorFile, { force: true })

  throw new Error('journalctl stopped')
}
