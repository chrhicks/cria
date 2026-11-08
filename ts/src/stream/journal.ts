import { spawn } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { parseRecord, stringField, type JsonRecord } from './json.ts'

interface JournalExclusions {
  readonly identifiers: ReadonlyArray<string>
  readonly unitPrefixes: ReadonlyArray<string>
}

function isExcluded(entry: JsonRecord | undefined, exclusions: JournalExclusions) {
  if (entry === undefined) return false

  const SYSLOG_IDENTIFIER = stringField(entry, 'SYSLOG_IDENTIFIER')
  const units = [stringField(entry, 'UNIT'), stringField(entry, '_SYSTEMD_UNIT'), stringField(entry, '_SYSTEMD_USER_UNIT')]

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

    const entry = parseRecord(line)

    if (!isExcluded(entry, exclusions)) await publish(line)

    const cursor = entry === undefined ? undefined : stringField(entry, '__CURSOR')

    if (cursor !== undefined) saveCursor(cursorFile, cursor)
  }

  if (linesRead === 0) rmSync(cursorFile, { force: true })

  throw new Error('journalctl stopped')
}
