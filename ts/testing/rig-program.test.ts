import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startIndiServer, type RunningIndiServer } from './indiserver.ts'
import { until } from './until.ts'

const program = join(import.meta.dirname, '..', 'src', 'bin', 'rig.ts')

let server: RunningIndiServer | undefined

afterEach(async () => {
  await server?.stop()
  server = undefined
})

function run(configPath: string, env: NodeJS.ProcessEnv = process.env) {
  const output: string[] = []
  const child = spawn(process.execPath, [program, configPath], { stdio: ['ignore', 'pipe', 'pipe'], env })
  const exit = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))

  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output.push(String(chunk)))

  return { child, exit, text: () => output.join('') }
}

function folder() {
  return mkdtempSync(join(tmpdir(), 'rig-program-'))
}

describe('the rig program', () => {
  it('brings a device up while the broker does not answer, and exits non-zero when indiserver goes away', async () => {
    const dir = folder()
    const fifo = join(dir, 'indi.fifo')

    execFileSync('mkfifo', [fifo])
    server = await startIndiServer(['indi_simulator_focus'], { fifo })

    const configPath = join(dir, 'rig.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        fifo,
        indiPort: server.port,
        pollMs: 200,
        settlePolls: 1,
        stream: { broker: { servers: 'nats://127.0.0.1:1' }, journalCursorFile: join(dir, 'cursor') },
        devices: [{ id: 'focuser', indiDevice: 'Focuser Simulator', serial: '/dev/null', driver: 'indi_simulator_focus', connected: true }],
      }),
    )

    const { exit, text } = run(configPath)

    await until('the focuser to be connected by the rig program', () => text().includes('focuser: writing CONNECTION') || undefined)

    await server.stop()
    server = undefined

    expect(await exit).toBe(1)
    expect(text()).toContain('indiserver connection lost')
  })

  it('keeps the devices up and does not exit when the journal follower keeps failing', async () => {
    const dir = folder()
    const fifo = join(dir, 'indi.fifo')
    const bin = join(dir, 'bin')

    execFileSync('mkfifo', [fifo])
    execFileSync('mkdir', [bin])
    writeFileSync(join(bin, 'journalctl'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'journalctl'), 0o755)
    server = await startIndiServer(['indi_simulator_focus'], { fifo })

    const configPath = join(dir, 'rig.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        fifo,
        indiPort: server.port,
        pollMs: 200,
        settlePolls: 1,
        stream: {
          broker: { servers: 'nats://127.0.0.1:1' },
          journalCursorFile: join(dir, 'cursor'),
          retrySeconds: 0.05,
        },
        devices: [{ id: 'focuser', indiDevice: 'Focuser Simulator', serial: '/dev/null', driver: 'indi_simulator_focus', connected: true }],
      }),
    )

    const { child, exit, text } = run(configPath, { ...process.env, PATH: `${bin}:${process.env.PATH}` })

    await until('the focuser to be connected by the rig program', () => text().includes('focuser: writing CONNECTION') || undefined)
    await until('the journal failure to be logged', () => text().includes('journal: journalctl stopped (exit 1)') || undefined)
    await new Promise(resolve => setTimeout(resolve, 400))

    expect(child.exitCode).toBeNull()
    expect(text().match(/journal: journalctl stopped/g)).toHaveLength(1)

    child.kill()
    await exit
  })

  it('exits 2, which systemd does not restart, when the rig file is not valid', async () => {
    const configPath = join(folder(), 'rig.json')

    writeFileSync(configPath, JSON.stringify({ devices: [] }))

    const { exit, text } = run(configPath)

    expect(await exit).toBe(2)
    expect(text()).toContain(configPath)
  })
})
