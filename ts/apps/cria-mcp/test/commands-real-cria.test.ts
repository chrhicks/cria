import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Schema, Scope } from 'effect'
import { FakeIndi, addCamera, addMount, type Behaviour } from '@cria/fake-indi'
import { ErrorBody, Operation, State, type OperationRequest } from '@cria/wire'
import { makeCriaClient } from '../../../testing/cria-client.js'
import { exposesAndSendsFrame, movesOnAxis } from './fake-rig.js'
import { callTool, startMcp, startRealCria } from './support.js'

const strict = { onExcessProperty: 'error' } as const
const sidereal60x = 0.2507

/** The camera and the mount of a real rig's shape, both on one fake INDI server. Commands reach only this fake. */
const fakeRig = (options: { readonly ignoreTracking?: boolean } = {}) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const indi = new FakeIndi()

      await indi.start()
      addCamera(indi, 'Fake CCD')
      addMount(indi, 'Fake Mount')

      const mount = movesOnAxis(indi, 'Fake Mount')
      const behaviour: Behaviour = (fake, vector, values, client) => {
        if (options.ignoreTracking && vector.name === 'TELESCOPE_TRACK_STATE') return 'handled'

        return vector.device === 'Fake Mount' ? mount(fake, vector, values, client) : exposesAndSendsFrame(fake, vector, values, client)
      }

      indi.behaviour = behaviour

      return indi
    }),
    indi => Effect.promise(() => indi.stop()),
  )

const readyDevices = (origin: string, commandsEnabled: boolean) =>
  Effect.promise(async () => {
    const client = makeCriaClient(origin)

    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await client.state()

      const read = !JSON.stringify(state.devices).includes('"reason":"not-read"')

      if (state.devices.length === 2 && read && (!commandsEnabled || state.devices.every(device => device.availability.ready))) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Cria never showed both devices ready')
  })

/** A Cria with commands enabled, the MCP server in front of it, and the agent's side of the conversation: every call goes through MCP. */
const rigWith = (options: { readonly ignoreTracking?: boolean; readonly commandsEnabled?: boolean; readonly fake?: FakeIndi; readonly scope?: Scope.Scope } = {}) =>
  Effect.gen(function* () {
    const fake = options.fake ?? (yield* fakeRig(options))
    const startCria = startRealCria(fake.port, { commandsEnabled: options.commandsEnabled ?? true })
    const cria = yield* options.scope === undefined ? startCria : Scope.provide(startCria, options.scope)

    yield* readyDevices(cria.origin, options.commandsEnabled ?? true)
    const mcp = yield* startMcp({ CRIA_URL: cria.origin })
    const answer = (name: string, args: unknown = {}) => callTool(mcp.url, name, args).pipe(Effect.map(result => result.structuredContent))
    const answered = (name: string, args: unknown = {}) =>
      answer(name, args).pipe(
        Effect.map(reply => {
          if (reply?.kind !== 'answered') throw new Error(`${name} was not answered: ${JSON.stringify(reply)}`)

          return reply.body
        }),
      )
    const state = answered('state').pipe(Effect.map(body => Schema.decodeUnknownSync(State)(body, strict)))
    const withIdentity = (deviceId: string, requestId: string) =>
      state.pipe(
        Effect.map(current => {
          const device = current.devices.find(candidate => candidate.id === deviceId)!

          return { instanceId: current.instanceId, requestId, deviceId, bindingId: device.bindingId, expectedName: device.name }
        }),
      )
    const settled = (operationId: string) =>
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 8; attempt++) {
          const operation = Schema.decodeUnknownSync(Operation)(yield* answered('wait', { operationId, maxSeconds: 10 }), strict)

          if (operation.state === 'settled') return operation
        }
        throw new Error(`operation ${operationId} did not settle`)
      })

    return { fake, cria, mcp, answer, answered, state, withIdentity, settled, direct: makeCriaClient(cria.origin) }
  })

const rig = rigWith()

const outcomeOf = (operation: Operation) => (operation.state === 'settled' ? operation.outcome : undefined)

describe('the command tools against a real Cria on fake INDI', () => {
  it.live('rotates the mount, stops it, and both settle: the rotate stopped, the stop confirmed', () =>
    Effect.gen(function* () {
      const { answered, answer, withIdentity, settled, state } = yield* rig
      const rotate = yield* answered('mount-rotate', { ...(yield* withIdentity('mount', 'rotate-1')), parameters: { rateDegreesPerSecond: sidereal60x, distanceDegrees: 10 } })

      expect(rotate).toMatchObject({ kind: 'mount-rotate', requestId: 'rotate-1' })
      expect(['waiting', 'running']).toContain(rotate.state)

      for (let attempt = 0; attempt < 50; attempt++) {
        const mount = (yield* state).devices.find(device => device.id === 'mount')

        if (mount?.kind === 'mount' && mount.readings.slewing.status !== 'unavailable' && mount.readings.slewing.value) break
        yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 100)))
      }

      const stop = yield* answered('mount-stop', yield* withIdentity('mount', 'stop-1'))

      expect(stop).toMatchObject({ kind: 'mount-stop', parameters: {} })

      const [stopped, rotated] = [yield* settled(stop.id), yield* settled(rotate.id)]

      expect(outcomeOf(stopped)?.kind).toBe('confirmed')
      expect(outcomeOf(rotated)?.kind).toBe('stopped')
      expect((yield* answer('operation', { operationId: rotate.id })).body).toEqual(JSON.parse(JSON.stringify(rotated)))
    }),
  )

  it.live('cancel stops a running rotate, and a cancel of an unknown operation is refused with Cria\'s own body', () =>
    Effect.gen(function* () {
      const { answered, answer, withIdentity, settled, direct } = yield* rig
      const rotate = yield* answered('mount-rotate', { ...(yield* withIdentity('mount', 'rotate-2')), parameters: { rateDegreesPerSecond: sidereal60x, distanceDegrees: 10 } })
      const cancelled = yield* answered('cancel', { operationId: rotate.id })

      expect(cancelled.id).toBe(rotate.id)
      expect(outcomeOf(yield* settled(rotate.id))?.kind).toBe('stopped')

      const unknown = '00000000-0000-4000-8000-000000000000'
      const refused = yield* answer('cancel', { operationId: unknown })
      const viaCria = yield* Effect.promise(() => direct.cancel(unknown))

      expect(refused).toEqual({ kind: 'refused', status: viaCria.status, body: viaCria.body })
      expect(refused.body.error.code).toBe('not-found')
    }),
  )

  it.live('captures, waits, and downloads the frame', () =>
    Effect.gen(function* () {
      const { answered, withIdentity, settled, mcp } = yield* rig
      const capture = yield* answered('capture', { ...(yield* withIdentity('camera', 'capture-1')), parameters: { exposureSeconds: 0.3, light: true } })
      const done = yield* settled(capture.id)
      const outcome = outcomeOf(done)

      if (outcome?.kind !== 'confirmed' || outcome.value.image === null) throw new Error(`the capture did not confirm: ${JSON.stringify(done)}`)
      const downloaded = yield* answered('image', { image: outcome.value.image })
      const onDisk = yield* Effect.promise(() => readFile(downloaded.path))

      expect(downloaded.path).toBe(`${mcp.imageDirectory}/${outcome.value.image.id}.imagebytes`)
      expect(createHash('sha256').update(onDisk).digest('hex')).toBe(outcome.value.image.sha256)
    }),
  )

  it.live('disconnects and reconnects a device', () =>
    Effect.gen(function* () {
      const { answered, withIdentity, settled, state } = yield* rig
      const connected = (id: string) => state.pipe(Effect.map(current => current.devices.find(device => device.id === id)!.availability))
      const off = yield* answered('device-connect', { ...(yield* withIdentity('camera', 'connect-off')), parameters: { connected: false } })

      expect(outcomeOf(yield* settled(off.id))?.kind).toBe('confirmed')
      expect(yield* connected('camera')).toMatchObject({ ready: false })

      const on = yield* answered('device-connect', { ...(yield* withIdentity('camera', 'connect-on')), parameters: { connected: true } })

      expect(outcomeOf(yield* settled(on.id))?.kind).toBe('confirmed')
      for (let attempt = 0; attempt < 50 && !(yield* connected('camera')).ready; attempt++) yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 100)))
      expect(yield* connected('camera')).toEqual({ ready: true })
    }),
  )

  it.live('finds the operation again by requestId, and a repeated requestId with the same content is Cria\'s to answer', () =>
    Effect.gen(function* () {
      const { answered, answer, withIdentity, settled } = yield* rig
      const input = { ...(yield* withIdentity('mount', 'tracking-1')), parameters: { tracking: true } }
      const first = yield* answered('mount-tracking', input)

      yield* settled(first.id)
      const found = yield* answered('request', { instanceId: input.instanceId, requestId: 'tracking-1' })
      const again = yield* answer('mount-tracking', input)
      const different = yield* answer('mount-tracking', { ...input, parameters: { tracking: false } })

      expect(found.id).toBe(first.id)
      expect(again).toMatchObject({ kind: 'answered', body: { id: first.id } })
      expect(different).toMatchObject({ kind: 'refused', body: { error: { code: 'request-conflict' } } })
    }),
  )

  it.live('a command carrying the instanceId of an earlier Cria is refused with instance-changed, unchanged', () =>
    Effect.gen(function* () {
      const fake = yield* fakeRig()
      const first = yield* Scope.make()
      const before = yield* rigWith({ fake, scope: first })
      const stale = yield* before.withIdentity('mount', 'after-restart')

      yield* Scope.close(first, Exit.void)
      const after = yield* rigWith({ fake })
      const body = { ...stale, parameters: { tracking: true } }
      const refused = yield* after.answer('mount-tracking', body)
      const viaCria = yield* Effect.promise(() => after.direct.submit({ ...body, kind: 'mount-tracking' } as unknown as OperationRequest))

      expect(refused).toMatchObject({ kind: 'refused', status: 409, body: { error: { code: 'instance-changed' } } })
      expect(refused).toEqual({ kind: 'refused', status: viaCria.status, body: viaCria.body })
      expect(Schema.decodeUnknownSync(ErrorBody)(refused.body, strict).instanceId).toBe((yield* after.state).instanceId)
      expect((yield* after.state).operations.map(operation => operation.requestId)).not.toContain('after-restart')
    }),
  )

  it.live('a Cria with commands disabled refuses a command with commands-disabled, unchanged', () =>
    Effect.gen(function* () {
      const { answer, withIdentity, direct } = yield* rigWith({ commandsEnabled: false })
      const body = { ...(yield* withIdentity('mount', 'disabled-1')), parameters: { tracking: true } }
      const refused = yield* answer('mount-tracking', body)
      const viaCria = yield* Effect.promise(() => direct.submit({ ...body, kind: 'mount-tracking' } as unknown as OperationRequest))

      expect(refused).toMatchObject({ kind: 'refused', body: { error: { code: 'commands-disabled' } } })
      expect(refused).toEqual({ kind: 'refused', status: viaCria.status, body: viaCria.body })
    }),
  )

  it.live('a held device blocks commands, and recover clears the hold', () =>
    Effect.gen(function* () {
      const fake = yield* fakeRig({ ignoreTracking: true })
      const { answered, answer, withIdentity, settled, state } = yield* rigWith({ fake, ignoreTracking: true })
      const tracking = yield* answered('mount-tracking', { ...(yield* withIdentity('mount', 'tracking-held')), parameters: { tracking: true } })

      expect(outcomeOf(yield* settled(tracking.id))?.kind).toBe('uncertain')

      const held = (yield* state).devices.find(device => device.id === 'mount')!

      expect(held.quarantine).toMatchObject({ held: true })

      const blocked = yield* answer('mount-park', yield* withIdentity('mount', 'park-blocked'))

      expect(blocked).toMatchObject({ kind: 'refused', body: { error: { code: 'device-blocked' } } })

      const notChecked = yield* answer('recover', { deviceId: 'mount', instanceId: held.bindingId, bindingId: held.bindingId, externalRecoveryConfirmed: true, note: 'wrong instance' })

      expect(notChecked.kind).toBe('refused')

      const recovered = yield* answered('recover', {
        deviceId: 'mount',
        instanceId: (yield* state).instanceId,
        bindingId: held.bindingId,
        externalRecoveryConfirmed: true,
        note: 'checked the fake mount by hand',
      })

      expect(recovered).toMatchObject({ id: 'mount', quarantine: { held: false } })
      expect((yield* state).devices.find(device => device.id === 'mount')!.quarantine).toEqual({ held: false })
      expect((yield* answered('operation', { operationId: tracking.id })).recovery).toMatchObject({ note: 'checked the fake mount by hand' })
    }),
  )
})
