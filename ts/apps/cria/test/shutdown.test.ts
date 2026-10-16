import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { OperationRequest } from '@cria/wire'
import { makeCriaClient } from '../../../testing/cria-client.js'
import { FakeIndi, addMount, am5, moveMount } from './fake-indi.js'
import { allReady, noneNotRead, until } from './harness.js'

const mount = 'ZWO AM5'
const root = join(import.meta.dirname, '..', '..', '..')
let fake: FakeIndi
let directory: string
let child: ChildProcess | undefined

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.behaviour = moveMount()
  directory = await mkdtemp(join(tmpdir(), 'cria-shutdown-'))
})

afterEach(async () => {
  child?.kill('SIGKILL')
  await fake.stop()
  await rm(directory, { recursive: true, force: true })
})

async function slewThenTerminate() {
  const config = join(directory, 'cria.json')

  await writeFile(
    config,
    JSON.stringify({
      listen: { host: '127.0.0.1', port: 0 },
      indi: { host: '127.0.0.1', port: fake.port },
      imageDirectory: join(directory, 'images'),
      livenessMs: 500,
      acknowledgeMs: 600,
      devices: [{ id: 'mount', kind: 'mount', indiDevice: mount }],
    }),
  )

  const env = { ...process.env }

  delete env.CRIA_TOKEN
  const service = spawn(
    process.execPath,
    ['--conditions=@cria/source', '--import', join(root, 'testing', 'source-hook.mjs'), join(root, 'apps', 'cria', 'src', 'main.ts'), config],
    { stdio: ['ignore', 'ignore', 'pipe'], env },
  )
  let log = ''
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => service.once('exit', (code, signal) => resolve({ code, signal })))

  child = service
  service.stderr!.on('data', chunk => void (log += String(chunk)))

  const port = await until('main.ts to print its port', () => /listening on (\d+)/.exec(log)?.[1], 15_000)
  const client = makeCriaClient(`http://127.0.0.1:${port}`)
  const state = await until('the mount to be ready with every reading read', async () => {
    const current = await client.state()

    return allReady(['mount'])(current) && noneNotRead(current) && current
  })
  const target = state.devices[0]!
  const slewing = await client.submit({
    instanceId: state.instanceId,
    requestId: crypto.randomUUID(),
    deviceId: target.id,
    bindingId: target.bindingId,
    expectedName: target.name,
    kind: 'mount-slew',
    parameters: { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' },
  } as unknown as OperationRequest)

  expect(slewing.status).toBe(202)
  await until('the fake mount to slew', () => fake.vector(mount, 'EQUATORIAL_EOD_COORD').state === 'Busy', 5000)

  service.kill('SIGTERM')
  const exit = await Promise.race([exited, new Promise<'still running'>(resolve => setTimeout(() => resolve('still running'), 20_000))])

  return { exit, log }
}

const aborts = () => fake.received.filter(xml => xml.startsWith('<newSwitchVector') && xml.includes('name="TELESCOPE_ABORT_MOTION"'))

it('SIGTERM during a slew sends the mount its abort, then exits 0', async () => {
  const { exit, log } = await slewThenTerminate()

  expect(exit).toEqual({ code: 0, signal: null })
  expect(log).toContain('cria: SIGTERM, stopping')
  expect(aborts()).toHaveLength(1)
  expect(fake.vector(mount, 'EQUATORIAL_EOD_COORD').state).toBe('Alert')
})

it('SIGTERM during a slew on an AM5 that coasts exits only once the mount stands still', async () => {
  const model = am5(fake, mount, { requireSiteAndTime: false })

  fake.behaviour = model.behaviour
  const { exit } = await slewThenTerminate()
  const movingAtExit = model.moving()

  expect([exit, movingAtExit, aborts().length]).toEqual([{ code: 0, signal: null }, false, 1])
}, 30_000)
