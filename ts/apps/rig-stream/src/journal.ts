import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Option, Schema } from 'effect'

const JournalEntry = Schema.fromJsonString(
  Schema.Struct({
    SYSLOG_IDENTIFIER: Schema.optionalKey(Schema.String),
    UNIT: Schema.optionalKey(Schema.String),
    _SYSTEMD_UNIT: Schema.optionalKey(Schema.String),
    _SYSTEMD_USER_UNIT: Schema.optionalKey(Schema.String),
  }),
)

const decodeEntry = Schema.decodeUnknownOption(JournalEntry)

export interface JournalExclusions {
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

export async function followJournal(exclusions: JournalExclusions, onLine: (line: string) => void) {
  const journal = spawn('journalctl', ['--follow', '--lines=0', '--output=json'], { stdio: ['ignore', 'pipe', 'inherit'] })

  for await (const line of createInterface({ input: journal.stdout })) {
    if (!isExcluded(line, exclusions)) onLine(line)
  }

  throw new Error('journalctl stopped')
}
