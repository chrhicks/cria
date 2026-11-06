import { chmodSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { followJournal, journalArguments, readCursor, saveCursor } from './journal.js'

const noExclusions = { identifiers: [], unitPrefixes: [] }

function folder() {
  return mkdtempSync(join(tmpdir(), 'rig-stream-journal-'))
}

function fakeJournalctl(dir: string, script: string) {
  const path = join(dir, 'journalctl')

  writeFileSync(path, `#!/bin/sh\necho "$*" > ${join(dir, 'arguments')}\n${script}\n`)
  chmodSync(path, 0o755)

  return path
}

describe('journal cursor', () => {
  it('starts at the present when nothing is remembered', () => {
    expect(journalArguments(undefined)).toEqual(['--follow', '--lines=0', '--output=json'])
  })

  it('resumes after the remembered line', () => {
    expect(journalArguments('s=abc')).toEqual(['--follow', '--after-cursor=s=abc', '--output=json'])
  })

  it('reads back what it saved, in a new folder', () => {
    const file = join(folder(), 'state', 'cursor')

    expect(readCursor(file)).toBeUndefined()
    saveCursor(file, 's=abc')
    expect(readCursor(file)).toBe('s=abc')
  })
})

describe('following the journal', () => {
  it('remembers each line after publishing it, including lines left off the stream', async () => {
    const dir = folder()
    const cursor = join(dir, 'cursor')
    const journalctl = fakeJournalctl(dir, `echo '{"__CURSOR":"one","SYSLOG_IDENTIFIER":"kernel"}'\necho '{"__CURSOR":"two","SYSLOG_IDENTIFIER":"sshd"}'`)
    const published: Array<string> = []
    const cursorsAtPublish: Array<string | undefined> = []

    await expect(followJournal({ identifiers: ['sshd'], unitPrefixes: [] }, cursor, async line => {
      published.push(line)
      cursorsAtPublish.push(readCursor(cursor))
    }, journalctl)).rejects.toThrow('journalctl stopped')

    expect(published).toEqual(['{"__CURSOR":"one","SYSLOG_IDENTIFIER":"kernel"}'])
    expect(cursorsAtPublish).toEqual([undefined])
    expect(readFileSync(cursor, 'utf8')).toBe('two')
  })

  it('keeps the place when publishing fails, so the line is sent again', async () => {
    const dir = folder()
    const cursor = join(dir, 'cursor')
    const journalctl = fakeJournalctl(dir, `echo '{"__CURSOR":"new"}'`)

    saveCursor(cursor, 'old')

    await expect(followJournal(noExclusions, cursor, () => Promise.reject(new Error('broker gone')), journalctl)).rejects.toThrow('broker gone')
    expect(readFileSync(cursor, 'utf8')).toBe('old')
    expect(readFileSync(join(dir, 'arguments'), 'utf8')).toContain('--after-cursor=old')
  })

  it('forgets a place journalctl cannot use, so the next start works', async () => {
    const dir = folder()
    const cursor = join(dir, 'cursor')
    const journalctl = fakeJournalctl(dir, 'exit 1')

    saveCursor(cursor, 'unusable')

    await expect(followJournal(noExclusions, cursor, () => Promise.resolve(), journalctl)).rejects.toThrow('journalctl stopped')
    expect(existsSync(cursor)).toBe(false)
  })
})
