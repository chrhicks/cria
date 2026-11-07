import { DeviceId, InstanceId, OperationId, RequestId, type Command } from '@cria/wire'
import { describe, expect, it } from 'vitest'
import { admit, cancel, initialState, prune, settle, snapshot, type LedgerState, type Rules, type Submission, type Transition } from './ledger.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const instanceId = InstanceId.make(uuid(1))
const mount = { id: DeviceId.make('mount'), kind: 'mount' } as const
const camera = { id: DeviceId.make('camera'), kind: 'camera' } as const
const focuser = { id: DeviceId.make('focuser'), kind: 'focuser' } as const
const box = { id: DeviceId.make('box'), kind: 'box' } as const
const rules: Rules = { instanceId, commandsEnabled: true, history: 3, devices: new Map([mount, camera, focuser, box].map(device => [device.id, device])) }
const empty = initialState()

const slew = { kind: 'mount-slew', parameters: { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' } } as const
const stop = { kind: 'mount-stop', parameters: {} } as const
const tracking = { kind: 'mount-tracking', parameters: { tracking: true } } as const
const confirmed = { kind: 'confirmed', value: { values: {}, image: null } } as const
const lost = { kind: 'uncertain', reason: 'no-acknowledgement', message: 'no answer' } as const

type Device = typeof mount | typeof camera | typeof focuser | typeof box
const request = (n: number, command: Command, device: Device = mount): Submission => ({
  instanceId,
  requestId: RequestId.make(`r${n}`),
  deviceId: device.id,
  ...command,
})

function admitted(state: LedgerState, n: number, command: Command, device: Device = mount) {
  return admit(rules, state, { submission: request(n, command, device), id: OperationId.make(uuid(100 + n)), now: n })
}

const id = (n: number) => OperationId.make(uuid(100 + n))
const ended = (state: LedgerState, n: number, outcome: Parameters<typeof settle>[2]['outcome'], now = 50 + n) =>
  settle(rules, state, { id: id(n), outcome, settledAt: now, now })
const stateOf = <A>([, next]: Transition<A>) => next
const resultOf = <A>([step]: Transition<A>) => step.result
const afterOf = <A>([step]: Transition<A>) => step.after.map(after => [after.kind, after.operation.id])
const states = (state: LedgerState) => [...state.operations.values()].map(operation => [operation.id, operation.state])

describe('admission', () => {
  const slewing = stateOf(admitted(empty, 1, slew))

  it('starts a motion on an idle device and records it running', () => {
    const started = admitted(empty, 1, slew)

    expect(resultOf(started)).toEqual({
      id: id(1),
      instanceId,
      requestId: 'r1',
      deviceId: 'mount',
      acceptedAt: 1,
      ...slew,
      state: 'running',
      startedAt: 1,
      progress: { phase: 'preparing', elapsedSeconds: null },
    })
    expect(afterOf(started)).toEqual([['start', id(1)]])
    expect(stateOf(started).revision).toBe(1)
  })

  it('records a halt on a busy device as waiting, with no timing, and asks the running motion to stop', () => {
    const queued = admitted(slewing, 2, stop)

    expect(resultOf(queued)).toEqual({
      id: id(2),
      instanceId,
      requestId: 'r2',
      deviceId: 'mount',
      acceptedAt: 2,
      ...stop,
      state: 'waiting',
    })
    expect(afterOf(queued)).toEqual([['stop', id(1)]])
  })

  it('refuses a motion or setting while a halt waits, and another device still admits', () => {
    const waiting = stateOf(admitted(slewing, 2, stop))

    expect(resultOf(admitted(waiting, 3, tracking))).toMatchObject({ code: 'device-busy', message: 'The device is running another operation' })
    expect(afterOf(admitted(waiting, 4, { kind: 'camera-configure', parameters: { gain: 2 } }, camera))).toEqual([['start', id(4)]])
  })

  it('returns the operation for a repeated request, and refuses the same ID with other content, on any device', () => {
    expect(admitted(slewing, 1, slew)).toEqual([{ result: [...slewing.operations.values()][0], after: [] }, slewing])
    expect(resultOf(admitted(slewing, 1, stop))).toMatchObject({ code: 'request-conflict' })
    expect(resultOf(admitted(slewing, 1, { kind: 'camera-configure', parameters: { gain: 2 } }, camera))).toMatchObject({ code: 'request-conflict' })
  })

  it('checks the instance, device, kind and commandsEnabled in that order', () => {
    const at = (submission: Submission, onRules = rules) => resultOf(admit(onRules, empty, { submission, id: id(9), now: 9 }))

    expect(at({ ...request(9, tracking), instanceId: InstanceId.make(uuid(9)), deviceId: DeviceId.make('nowhere') })).toMatchObject({ code: 'instance-changed' })
    expect(at({ ...request(9, tracking), deviceId: DeviceId.make('nowhere') })).toMatchObject({ code: 'request-error', message: 'Unknown device nowhere' })
    expect(at(request(9, { kind: 'capture', parameters: { exposureSeconds: 1, light: true } }))).toMatchObject({ code: 'request-error', message: 'A mount cannot run capture' })
    expect(at(request(9, tracking), { ...rules, commandsEnabled: false })).toMatchObject({ code: 'commands-disabled' })
  })
})

describe('settling', () => {
  const queued = stateOf(admitted(stateOf(admitted(stateOf(admitted(empty, 1, slew)), 2, stop)), 3, stop))

  it('starts the oldest waiting halt in the transition that settles the motion, so nothing is admitted between', () => {
    const settled = ended(queued, 1, { kind: 'stopped' })
    const next = stateOf(settled)

    expect(afterOf(settled)).toEqual([['start', id(2)]])
    expect(states(next)).toEqual([
      [id(1), 'settled'],
      [id(2), 'running'],
      [id(3), 'waiting'],
    ])
    expect(next.operations.get(id(2))).toMatchObject({ startedAt: 51, progress: { phase: 'preparing', elapsedSeconds: null } })
    expect(resultOf(admitted(next, 4, tracking))).toMatchObject({ code: 'device-busy' })
  })

  it('runs a repeated stop in its turn instead of failing it', () => {
    const second = ended(stateOf(ended(queued, 1, { kind: 'stopped' })), 2, confirmed)

    expect(afterOf(second)).toEqual([['start', id(3)]])
    expect(states(stateOf(ended(stateOf(second), 3, confirmed)))).toEqual([
      [id(1), 'settled'],
      [id(2), 'settled'],
      [id(3), 'settled'],
    ])
  })

  it('ignores a late or repeated notice: only its own still-running operation settles', () => {
    const once = stateOf(ended(queued, 1, { kind: 'stopped' }))

    expect(ended(once, 1, confirmed)).toEqual([{ result: undefined, after: [] }, once])
    expect(ended(queued, 3, confirmed)).toEqual([{ result: undefined, after: [] }, queued])
  })
})

describe('cancel', () => {
  const queued = stateOf(admitted(stateOf(admitted(empty, 1, slew)), 2, stop))

  it('stops a running motion, and returns a halt, waiting or running, unchanged with nothing to do', () => {
    const halting = stateOf(ended(queued, 1, { kind: 'stopped' }))

    expect(afterOf(cancel(queued, id(1)))).toEqual([['stop', id(1)]])
    expect(cancel(queued, id(2))).toEqual([{ result: queued.operations.get(id(2)), after: [] }, queued])
    expect(cancel(halting, id(2))).toEqual([{ result: halting.operations.get(id(2)), after: [] }, halting])
  })

  it('returns a settled operation unchanged, and refuses an unknown one', () => {
    const settled = stateOf(ended(queued, 1, { kind: 'stopped' }))

    expect(cancel(settled, id(1))).toEqual([{ result: settled.operations.get(id(1)), after: [] }, settled])
    expect(resultOf(cancel(settled, id(9)))).toMatchObject({ code: 'not-found' })
  })
})

describe('an uncertain ending', () => {
  it.each([
    ['mount', mount, tracking],
    ['camera', camera, { kind: 'capture', parameters: { exposureSeconds: 1, light: true } }],
    ['focuser', focuser, { kind: 'focuser-move', parameters: { position: 1000 } }],
    ['box', box, { kind: 'switch-set', parameters: { channelId: 0, value: 1 } }],
  ] as const)('holds nothing on a %s: the next command is admitted', (_name, device, command) => {
    const after = stateOf(ended(stateOf(admitted(empty, 1, command as Command, device)), 1, lost))

    expect(resultOf(admitted(after, 2, command as Command, device))).toMatchObject({ state: 'running' })
    expect(resultOf(cancel(after, id(1)))).toMatchObject({ state: 'settled', outcome: lost })
  })

  it('admits the next mount command after a confirmed one', () => {
    const after = stateOf(ended(stateOf(admitted(empty, 1, tracking)), 1, confirmed))

    expect(resultOf(admitted(after, 2, tracking))).toMatchObject({ state: 'running' })
  })
})

describe('retention', () => {
  it('prunes an uncertain ending like any other', () => {
    const cameraOps = [1, 2, 3, 4, 5].reduce(
      (state, n) => stateOf(ended(stateOf(admitted(state, n, { kind: 'capture', parameters: { exposureSeconds: 1, light: true } }, camera)), n, n === 1 ? lost : confirmed)),
      empty,
    )

    expect(states(cameraOps).map(([operation]) => operation)).toEqual([id(3), id(4), id(5)])
  })

  it('drops the oldest settled operations beyond history, and keeps every request ID', () => {
    const steps = [2, 3, 4, 5].reduce(
      (state, n) => stateOf(ended(stateOf(admitted(state, n, stop)), n, confirmed)),
      stateOf(ended(stateOf(admitted(empty, 1, tracking)), 1, lost)),
    )

    expect(states(steps)).toEqual([
      [id(3), 'settled'],
      [id(4), 'settled'],
      [id(5), 'settled'],
    ])
    expect(resultOf(admitted(steps, 2, stop))).toMatchObject({ code: 'result-expired' })
    expect(resultOf(cancel(steps, id(2)))).toMatchObject({ code: 'result-expired' })
    expect(prune(rules, steps)).toBe(steps)
  })
})

describe('snapshot', () => {
  it('counts snapshots from 1 and carries the revision of the state it read', () => {
    const changed = stateOf(admitted(empty, 1, tracking))
    const first = snapshot(rules, changed)
    const second = snapshot(rules, stateOf(first))

    expect([resultOf(first).sequence, resultOf(second).sequence, resultOf(first).revision]).toEqual([1, 2, 1])
    expect(stateOf(second).revision).toBe(1)
    expect(resultOf(snapshot(rules, empty)).sequence).toBe(1)
  })
})
