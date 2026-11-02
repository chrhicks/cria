import { afterEach, expect, it } from 'vitest'
import { Schema } from 'effect'
import { MountLease, Operation, type LeaseRequest } from '@cria/wire'
import { FakeIndi, addMount, loadAm5Fixtures, playMotion } from '@cria/fake-indi'
import { allReady, startCria, until, type Cria } from './harness.js'

let fake: FakeIndi
let cria: Cria
const mount = 'ZWO AM5'

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

async function start() {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  playMotion(fake, mount, [loadAm5Fixtures()['home-abort']!], { timeScale: 4 })
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, motion: { positionReadMs: 250 } }], { acknowledgeMs: 600, mountLeaseRequired: true })
  const state = await cria.waitFor(allReady(['mount']))

  return { instanceId: state.instanceId, bindingId: (await cria.device('mount')).bindingId }
}

async function lease(request: LeaseRequest) {
  const response = await fetch(`${cria.base}/v2/devices/mount/lease`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })

  expect(response.status).toBe(200)

  return Schema.decodeUnknownSync(MountLease)(await response.json())
}

it('refuses an older client before sending any motion command', async () => {
  await start()
  const before = fake.received.filter(xml => xml.startsWith('<new')).length
  const refused = await cria.submit('mount', 'mount-home', {})

  expect(refused).toMatchObject({ ok: false, body: { error: { code: 'request-error', message: expect.stringMatching(/valid mount lease/) } } })
  expect(fake.received.filter(xml => xml.startsWith('<new'))).toHaveLength(before)
})

it('stops a lapsed holder through the confirmed abort, after the recorded coast', async () => {
  const identity = await start()
  const held = await lease({ ...identity, action: 'acquire', holder: 'fixture-client' })
  const response = await fetch(`${cria.base}/v2/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...identity, deviceId: 'mount', expectedName: mount, requestId: crypto.randomUUID(), leaseId: held.id, kind: 'mount-home', parameters: {} }) })
  const operation = Schema.decodeUnknownSync(Operation)(await response.json())

  await until('home to start', () => fake.vector(mount, 'TELESCOPE_HOME').state === 'Busy')
  const ending = await cria.settled(operation.id)

  expect(ending).toMatchObject({ kind: 'stopped', quarantined: false })
  expect(ending.operation.motion?.stopped).toMatchObject({ how: 'aborted', reason: 'Mount lease expired for fixture-client' })
  expect(ending.operation.motion!.stopped.at).toBeGreaterThanOrEqual(held.expiresAt)
  expect(fake.received.filter(xml => xml.startsWith('<new') && xml.includes('name="TELESCOPE_ABORT_MOTION"')).length).toBeGreaterThan(0)
  expect(fake.vector(mount, 'TELESCOPE_HOME').state).toBe('Busy')
  const fresh = await lease({ ...identity, action: 'acquire', holder: 'next-client' })

  expect(fresh.id).not.toBe(held.id)
})
