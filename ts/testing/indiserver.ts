/**
 * Test support: run a real indiserver with INDI simulator drivers on a free
 * port. Requires libindi (indiserver and the indi_simulator_* drivers).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'

export interface RunningIndiServer {
  readonly port: number
  readonly stop: () => Promise<void>
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function waitForPort(port: number, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>(resolve => {
      const socket = net.connect(port, '127.0.0.1')

      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })

    if (open) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  throw new Error(`indiserver did not listen on ${port}`)
}

/** `-r 0`: a crashed driver is not restarted, as on the rig. */
export async function startIndiServer(drivers: ReadonlyArray<string>): Promise<RunningIndiServer> {
  const port = await freePort()
  const child: ChildProcess = spawn('indiserver', ['-r', '0', '-u', `/tmp/cria-test-indiserver-${port}`, '-p', String(port), ...drivers], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let log = ''

  child.stderr?.on('data', chunk => {
    log = (log + String(chunk)).slice(-4000)
  })

  try {
    await waitForPort(port, Date.now() + 5000)
  } catch (error) {
    child.kill('SIGKILL')
    throw new Error(`${(error as Error).message}\n${log}`)
  }

  return {
    port,
    stop: () =>
      new Promise(resolve => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      }),
  }
}

