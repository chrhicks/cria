import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, PubSub, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstanceId } from '@cria/wire'
import type { LedgerSnapshot } from '../operation/ledger.js'
import type { Rig } from '../rig.js'
import { makeEventStream } from './sse.js'

function fakeRig() {
  const revisions = Effect.runSync(PubSub.unbounded<number>())
  let current = 0
  let gate: Promise<void> | undefined

  const snapshot = Effect.gen(function* () {
    const revision = current

    if (gate) yield* Effect.promise(() => gate!)

    return { sequence: revision, revision, operations: [], facts: () => undefined as never } satisfies LedgerSnapshot
  })

  const rig = {
    instanceId: 'b8a3c1d2-0000-4000-8000-000000000001' as InstanceId,
    config: { commandsEnabled: true },
    devices: [],
    ledger: { snapshot, revisions: Stream.fromPubSub(revisions) },
  } as unknown as Rig

  return {
    rig,
    change: () => {
      current += 1
      Effect.runSync(PubSub.publish(revisions, current))
    },
    hold: () => {
      let release!: () => void

      gate = new Promise(resolve => (release = resolve))

      return () => {
        gate = undefined
        release()
      }
    },
  }
}

class FakeResponse {
  readonly writes: string[] = []
  writableNeedDrain = false
  destroyed = false
  status = 0

  writeHead(status: number) {
    this.status = status
  }

  write(chunk: string) {
    this.writes.push(chunk)

    return true
  }

  destroy() {
    this.destroyed = true
  }

  get events() {
    return this.writes.map(chunk => `state:${JSON.parse(/^data: (.*)$/m.exec(chunk)![1]!).sequence}`)
  }
}

function subscribe(events: ReturnType<typeof makeEventStream>) {
  const request = new EventEmitter()
  const response = new FakeResponse()
  const accepted = events(request as IncomingMessage, response as unknown as ServerResponse)

  return { accepted, response, close: () => request.emit('close') }
}

async function settle() {
  for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setImmediate(resolve))
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

let open: Array<() => void> = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  for (const close of open) close()
  open = []
  vi.useRealTimers()
})

function opened(events: ReturnType<typeof makeEventStream>) {
  const subscription = subscribe(events)

  open.push(subscription.close)

  return subscription
}

describe('GET /v2/events', () => {
  it('opens with a snapshot of the current revision', async () => {
    const fake = fakeRig()

    fake.change()
    fake.change()
    const { accepted, response } = opened(makeEventStream(fake.rig))

    await settle()

    expect(accepted).toBe(true)
    expect(response.status).toBe(200)
    expect(response.events).toEqual(['state:2'])
  })

  it('coalesces rapid changes into one snapshot at the next 250 ms tick', async () => {
    const fake = fakeRig()
    const { response } = opened(makeEventStream(fake.rig))

    await settle()
    for (let change = 0; change < 5; change++) {
      fake.change()
      await settle()
    }

    expect(response.events).toEqual(['state:0'])
    await advance(250)
    expect(response.events).toEqual(['state:0', 'state:5'])
  })

  it('sends an idle subscriber a snapshot every second', async () => {
    const fake = fakeRig()
    const { response } = opened(makeEventStream(fake.rig))

    await settle()
    await advance(750)
    expect(response.events).toEqual(['state:0'])
    await advance(250)
    expect(response.events).toEqual(['state:0', 'state:0'])
    await advance(4000)
    expect(response.events).toEqual(['state:0', 'state:0', 'state:0', 'state:0', 'state:0', 'state:0'])
  })

  it('sends again when a change lands while a snapshot is being built', async () => {
    const fake = fakeRig()
    const { response } = opened(makeEventStream(fake.rig))

    await settle()
    const release = fake.hold()

    fake.change()
    await advance(250)
    fake.change()
    await settle()
    release()
    await settle()

    expect(response.events).toEqual(['state:0', 'state:1'])
    await advance(250)
    expect(response.events).toEqual(['state:0', 'state:1', 'state:2'])
  })

  it('holds writes to a subscriber that is not draining, and drops it after 30 s stuck', async () => {
    const fake = fakeRig()
    const { response } = opened(makeEventStream(fake.rig))

    await settle()
    response.writableNeedDrain = true
    fake.change()
    await advance(30_000)

    expect([response.events, response.destroyed]).toEqual([['state:0'], false])
    await advance(250)
    expect(response.destroyed).toBe(true)
  })

  it('does not drop a subscriber that drains before 30 s, and sends it the latest snapshot', async () => {
    const fake = fakeRig()
    const { response } = opened(makeEventStream(fake.rig))

    await settle()
    response.writableNeedDrain = true
    fake.change()
    await advance(20_000)
    response.writableNeedDrain = false
    await advance(250)
    response.writableNeedDrain = true
    await advance(20_000)

    expect([response.events, response.destroyed]).toEqual([['state:0', 'state:1'], false])
  })

  it('refuses a 17th subscriber, and accepts one again once a subscriber leaves', async () => {
    const fake = fakeRig()
    const events = makeEventStream(fake.rig)
    const sixteen = Array.from({ length: 16 }, () => opened(events))
    const refused = subscribe(events)

    expect(sixteen.map(subscription => subscription.accepted)).toEqual(Array(16).fill(true))
    expect([refused.accepted, refused.response.status, refused.response.writes]).toEqual([false, 0, []])

    sixteen[0]!.close()
    expect(opened(events).accepted).toBe(true)
  })

  it('stops writing to a subscriber once its request closes', async () => {
    const fake = fakeRig()
    const { response, close } = subscribe(makeEventStream(fake.rig))

    await settle()
    close()
    fake.change()
    await advance(2000)

    expect(response.events).toEqual(['state:0'])
  })
})
