import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
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

function run(configPath: string) {
  const output: string[] = []
  const child = spawn(process.execPath, [program, configPath], { stdio: ['ignore', 'pipe', 'pipe'] })
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
    writeFileSync(join(dir, 'broker.pass'), 'secret\n')
    server = await startIndiServer(['indi_simulator_focus'], { fifo })

    const configPath = join(dir, 'rig.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        fifo,
        indiPort: server.port,
        pollMs: 200,
        settlePolls: 1,
        stream: { broker: { servers: 'nats://127.0.0.1:1', user: 'test', passFile: join(dir, 'broker.pass') }, journalCursorFile: join(dir, 'cursor') },
        devices: [{ id: 'focuser', indiDevice: 'Focuser Simulator', serial: '/dev/null', driver: 'indi_simulator_focus', connected: true }],
      }),
    )

    const { exit, text } = run(configPath)

    await until('the focuser to be connected by the rig program', () => text().includes('focuser: writing CONNECTION') || undefined)
    expect(text()).not.toContain('secret')

    await server.stop()
    server = undefined

    expect(await exit).toBe(1)
    expect(text()).toContain('indiserver connection lost')
  })

  it('exits 2, which systemd does not restart, when the rig file is not valid', async () => {
    const configPath = join(folder(), 'rig.json')

    writeFileSync(configPath, JSON.stringify({ devices: [] }))

    const { exit, text } = run(configPath)

    expect(await exit).toBe(2)
    expect(text()).toContain(configPath)
  })
})
