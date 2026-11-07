import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi, type Behaviour, addCamera, addMount } from '@cria/fake-indi'
import { exposeNormally, moveMount } from './drivers.js'
import { allReady, startCria, until, type Cria } from './harness.js'

const mount = 'ZWO AM5'
const camera = 'Fake CCD'
const slew = { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' }

let fake: FakeIndi

const aborts = () => fake.received.filter(xml => xml.includes('name="TELESCOPE_ABORT_MOTION"')).length
const slewing = () => fake.vector(mount, 'EQUATORIAL_EOD_COORD').state === 'Busy'

const abortWithoutStopping: Behaviour = (fake, vector, values) => {
  if (vector.name !== 'TELESCOPE_ABORT_MOTION') return moveMount()(fake, vector, values)
  fake.update(mount, vector.name, { state: 'Ok' })

  return 'handled'
}
const release = () => fake.update(mount, 'EQUATORIAL_EOD_COORD', { state: 'Alert' })

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, mount)
  fake.behaviour = moveMount()
})

afterEach(async () => {
  await fake.stop()
})

describe('one mount', () => {
  let cria: Cria

  beforeEach(async () => {
    cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount, motion: { positionReadMs: 250 } }], { acknowledgeMs: 600, operationHistory: 10 })
    await cria.waitFor(allReady(['mount']))
  })

  afterEach(async () => {
    await cria.stop()
  })

  const state = async (id: string) => {
    const reply = await cria.client.operation(id)

    if (!reply.ok) throw new Error(`${id}: ${reply.body.error.code}`)

    return reply.body.state
  }

  const slewUnderWay = async () => {
    const moving = await cria.submit('mount', 'mount-slew', slew)

    await until('the slew under way', slewing)

    return moving.body.id
  }

  it('two stops queued behind a slew both run: each settles confirmed, and each sends the abort', async () => {
    fake.behaviour = abortWithoutStopping
    const moving = await slewUnderWay()
    const first = await cria.submit('mount', 'mount-stop', {})
    const second = await cria.submit('mount', 'mount-stop', {})

    expect([first.status, second.status]).toEqual([202, 202])
    await until('the slew asked to stop', () => aborts() === 1)
    release()

    const endings = [await cria.settled(moving), await cria.settled(first.body.id), await cria.settled(second.body.id)]

    expect(endings.map(ending => [ending.kind, ending.reason])).toEqual([
      ['stopped', null],
      ['confirmed', null],
      ['confirmed', null],
    ])
    expect(aborts()).toBe(3)
  })

  it('a stop waiting behind a slew is waiting; cancelling it returns it unchanged, and it still runs', async () => {
    fake.behaviour = abortWithoutStopping
    const moving = await slewUnderWay()
    const stop = await cria.submit('mount', 'mount-stop', {})
    const before = await cria.client.operation(stop.body.id)
    const cancelled = await cria.cancel(stop.body.id)

    expect(before).toMatchObject({ status: 200, body: { state: 'waiting' } })
    expect(cancelled).toEqual({ status: 202, ok: true, body: before.body })

    release()
    expect((await cria.settled(moving)).kind).toBe('stopped')
    expect((await cria.settled(stop.body.id)).kind).toBe('confirmed')
  })

  it('refuses a motion or setting while a stop waits: device-busy, never queued', async () => {
    fake.behaviour = abortWithoutStopping
    const moving = await slewUnderWay()
    const stop = await cria.submit('mount', 'mount-stop', {})
    const tracking = await cria.submit('mount', 'mount-tracking', { tracking: true })

    expect(await state(stop.body.id)).toBe('waiting')
    expect(tracking).toMatchObject({ status: 409, body: { error: { code: 'device-busy' } } })

    release()
    expect((await cria.settled(moving)).kind).toBe('stopped')
    expect((await cria.settled(stop.body.id)).kind).toBe('confirmed')
    expect(fake.received.filter(xml => xml.includes('name="TELESCOPE_TRACK_STATE"'))).toEqual([])
  })

  it('a late cancel of a settled operation returns it unchanged and does not touch the one running now', async () => {
    const tracked = await cria.run('mount', 'mount-tracking', { tracking: true })
    const moving = await slewUnderWay()
    const late = await cria.cancel(tracked.id)

    expect(late).toEqual({ status: 202, ok: true, body: tracked.operation })
    expect(await state(moving)).toBe('running')
    expect(aborts()).toBe(0)

    await cria.cancel(moving)
    expect((await cria.settled(moving)).kind).toBe('stopped')
  })

  it('a submit racing the settle of the running operation is refused device-busy or admitted, never failed busy', async () => {
    fake.behaviour = moveMount({ finishAfterMs: 300 })
    const moving = await cria.submit('mount', 'mount-slew', slew)
    const refusals: string[] = []
    let admitted: string | undefined

    await until('a tracking change admitted after the slew', async () => {
      const reply = await cria.submit('mount', 'mount-tracking', { tracking: true })

      if (reply.ok) admitted = reply.body.id
      else refusals.push(reply.body.error.code)

      return admitted !== undefined
    })

    expect((await cria.settled(moving.body.id)).kind).toBe('confirmed')
    expect(new Set(refusals)).toEqual(new Set(['device-busy']))
    expect((await cria.settled(admitted!)).kind).toBe('confirmed')
  })

  it('retention keeps every request ID', async () => {
    const requestId = crypto.randomUUID()
    const first = await cria.submit('mount', 'mount-stop', {}, requestId)

    await cria.settled(first.body.id)
    for (let stop = 0; stop < 10; stop++) await cria.run('mount', 'mount-stop', {})
    const sent = aborts()

    expect((await cria.client.operation(first.body.id)).body).toMatchObject({ error: { code: 'result-expired' } })
    expect(await cria.submit('mount', 'mount-stop', {}, requestId)).toMatchObject({ status: 410, body: { error: { code: 'result-expired' } } })
    expect(aborts()).toBe(sent)
  })
})

describe('two failure domains', () => {
  it('one request ID sent to two domains at once admits exactly one operation', async () => {
    addCamera(fake, camera)
    fake.behaviour = (fake, vector, values) => (vector.device === camera ? exposeNormally()(fake, vector, values) : moveMount()(fake, vector, values))
    const cria = await startCria(fake.port, [
      { id: 'mount', kind: 'mount', indiDevice: mount },
      { id: 'camera', kind: 'camera', indiDevice: camera },
    ])

    try {
      await cria.waitFor(allReady(['mount', 'camera']))
      const requestId = crypto.randomUUID()
      const replies = await Promise.all([
        cria.submit('mount', 'mount-tracking', { tracking: true }, requestId),
        cria.submit('camera', 'camera-configure', { gain: 2 }, requestId),
      ])
      const admitted = replies.flatMap(reply => (reply.ok ? [reply.body.id] : []))
      const refused = replies.flatMap(reply => (reply.ok ? [] : [reply.body.error.code]))
      const found = await cria.client.byRequest((await cria.state()).instanceId, requestId)

      expect([admitted.length, refused]).toEqual([1, ['request-conflict']])
      expect(found).toMatchObject({ status: 200, body: { id: admitted[0] } })
      expect((await cria.state()).operations.filter(operation => operation.requestId === requestId)).toHaveLength(1)
    } finally {
      await cria.stop()
    }
  })
})

describe('snapshot sequence', () => {
  it('counts snapshots per rig: two rigs in one process each start at 1, and GET and SSE never repeat one', async () => {
    const first = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount }])
    const second = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: mount }])

    try {
      const starts = [(await first.client.state()).sequence, (await second.client.state()).sequence]
      const seen = [starts[0]!]

      for (let round = 0; round < 3; round++) {
        seen.push((await first.client.firstEvent()).sequence)
        seen.push((await first.client.state()).sequence)
      }

      expect(starts).toEqual([1, 1])
      expect(seen).toEqual([...seen].sort((a, b) => a - b))
      expect(new Set(seen).size).toBe(seen.length)
    } finally {
      await first.stop()
      await second.stop()
    }
  })
})
