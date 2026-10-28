#!/usr/bin/env node
/**
 * cria-archive [--apply] [options] SESSION...
 *
 * Archives each named session (a folder name under errai's recording folder) to thuban. Without `--apply` it
 * does steps 1 to 5 (copy, keep, pack, check, move into the archive) and only says what it would delete on
 * errai. Every run writes a status file and logs the same lines. docs/ts/SPEC.md, "Archiving a recording",
 * has the steps and the exit codes.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { archiveSessions, type RunStatus } from './archive.js'
import { localSource } from './source.js'
import { spawnSsh, sshSource } from './source-ssh.js'

const DAY_MS = 24 * 60 * 60 * 1000

const usage = `usage: cria-archive [--apply] [--allow-unmatched] [--host errai | --source-dir DIR] [--remote-dir DIR]
                    [--archive-dir DIR] [--staging DIR] [--vela-dir DIR] [--rig-id ID] [--state FILE]
                    [--min-age-days N] SESSION...`

async function writeStatus(path: string, status: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(status, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      apply: { type: 'boolean', default: false },
      'allow-unmatched': { type: 'boolean', default: false },
      host: { type: 'string', default: 'errai' },
      'remote-dir': { type: 'string', default: '/home/chicks/cria-recordings' },
      'source-dir': { type: 'string' },
      'archive-dir': { type: 'string', default: '/mnt/storage/cria-archive' },
      staging: { type: 'string' },
      'vela-dir': { type: 'string', default: join(homedir(), '.local/share/vela') },
      'rig-id': { type: 'string' },
      state: { type: 'string', default: join(process.env['XDG_STATE_HOME'] || join(homedir(), '.local/state'), 'cria/recording-archive.json') },
      'min-age-days': { type: 'string', default: '3' },
    },
  })
}

async function main(): Promise<number> {
  let parsed: ReturnType<typeof parse>

  try {
    parsed = parse()
  } catch (error) {
    console.error(`cria-archive: ${error instanceof Error ? error.message : String(error)}\n${usage}`)

    return 2
  }

  const { values, positionals } = parsed
  const minAgeDays = /^\d+(\.\d+)?$/.test(values['min-age-days']) ? Number(values['min-age-days']) : NaN

  if (positionals.length === 0 || !(minAgeDays >= 0)) {
    console.error(usage)

    return 2
  }

  const archiveDir = values['archive-dir']
  const log = (line: string) => console.log(`cria-archive: ${line}`)
  const source = values['source-dir'] === undefined ? sshSource({ spawnRemote: spawnSsh(values.host), directory: values['remote-dir'] }) : localSource(values['source-dir'])
  const status: RunStatus = await archiveSessions(positionals, {
    source,
    stagingDir: values.staging ?? join(archiveDir, '.staging'),
    archiveDir,
    velaDir: values['vela-dir'],
    ...(values['rig-id'] === undefined ? {} : { rigId: values['rig-id'] }),
    apply: values.apply,
    allowUnmatched: values['allow-unmatched'],
    policy: { minAgeMs: minAgeDays * DAY_MS, liveWindowMs: 30 * 60 * 1000 },
    now: Date.now,
    log,
  })

  await writeStatus(values.state, status)
  for (const session of status.sessions) {
    log(`${session.name}: ${session.state}${session.reason ? ` (${session.reason})` : ''}; source: ${session.source}${session.frames ? `; frames kept ${session.frames.kept}, pruned ${session.frames.pruned}, unmatched ${session.frames.unmatched}` : ''}`)
  }
  log(`${status.mode}: ${status.ok ? 'ok' : 'NOT ok'}; status written to ${values.state}`)

  return status.ok ? 0 : 1
}

main().then(
  code => process.exit(code),
  error => {
    console.error(`cria-archive: failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
