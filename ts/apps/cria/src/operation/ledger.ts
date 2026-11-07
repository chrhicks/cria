import { Deferred, Effect, PubSub, Ref, Scope, Stream } from 'effect'
import { makeRun, type Ending, type Outcome, type Report, type RunView } from '@cria/primitives'
import {
  commands,
  isHalt,
  type Command,
  type DeviceId,
  type DeviceKind,
  type FailureDomain,
  type InstanceId,
  type MotionRecord,
  type Operation,
  type OperationId,
  type OperationResult,
  type Progress,
  type RequestId,
} from '@cria/wire'
import { mint } from '../ids.js'
import { Refusal, refuse } from '../refusal.js'

export type Stored = Operation
export type Running = Extract<Stored, { readonly state: 'running' }>
type Waiting = Extract<Stored, { readonly state: 'waiting' }>
type Ended = Extract<Stored, { readonly state: 'settled' }>
type Open = Running | Waiting
type Settled = Extract<Operation, { readonly state: 'settled' }>

export type Submission = Command & {
  readonly instanceId: InstanceId
  readonly requestId: RequestId
  readonly deviceId: DeviceId
}

export interface Placement {
  readonly id: DeviceId
  readonly kind: DeviceKind
  readonly failureDomain: FailureDomain
}

export interface Rules {
  readonly instanceId: InstanceId
  readonly commandsEnabled: boolean
  readonly history: number
  readonly devices: ReadonlyMap<DeviceId, Placement>
}

export interface LedgerState {
  readonly operations: ReadonlyMap<OperationId, Stored>
  readonly requests: ReadonlyMap<RequestId, { readonly fingerprint: string; readonly operation: OperationId }>
  readonly waiters: ReadonlyMap<OperationId, ReadonlyArray<Deferred.Deferred<Settled>>>
  readonly revision: number
  readonly sequence: number
}

export type After =
  | { readonly kind: 'start'; readonly operation: Running }
  | { readonly kind: 'stop'; readonly operation: Running }
  | { readonly kind: 'resolve'; readonly waiters: ReadonlyArray<Deferred.Deferred<Settled>>; readonly operation: Settled }

export interface Step<A> {
  readonly result: A
  readonly after: ReadonlyArray<After>
}

export type Transition<A> = readonly [Step<A>, LedgerState]

export interface LedgerSnapshot {
  readonly sequence: number
  readonly revision: number
  readonly operations: ReadonlyArray<Operation>
  readonly busy: (failureDomain: FailureDomain) => boolean
}

const initialProgress: Progress = { phase: 'preparing', elapsedSeconds: null }

const settledKept = 16
const settledShown = 20

export function initialState(): LedgerState {
  return {
    operations: new Map(),
    requests: new Map(),
    waiters: new Map(),
    revision: 0,
    sequence: 0,
  }
}

const step = <A>(result: A, after: ReadonlyArray<After> = []): Step<A> => ({ result, after })
const changed = (state: LedgerState, patch: Partial<LedgerState>): LedgerState => ({ ...state, ...patch, revision: state.revision + 1 })
const put = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => new Map(map).set(key, value)

function known<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key)

  if (value === undefined) throw new Error(`Ledger invariant: nothing kept for ${String(key)}`)

  return value
}

const openIn = (state: LedgerState, failureDomain: FailureDomain): ReadonlyArray<Open> =>
  [...state.operations.values()].filter((operation): operation is Open => operation.failureDomain === failureDomain && operation.state !== 'settled')


function missing(state: LedgerState, id: OperationId): Refusal {
  const expired = [...state.requests.values()].some(marker => marker.operation === id)

  return expired ? refuse('result-expired', 'The operation is no longer kept') : refuse('not-found', 'No such operation')
}

export function admit(
  rules: Rules,
  state: LedgerState,
  input: { readonly submission: Submission; readonly id: OperationId; readonly now: number },
): Transition<Operation | Refusal> {
  const { submission, id, now } = input
  const refused = (refusal: Refusal): Transition<Refusal> => [step(refusal), state]
  const fingerprint = fingerprintOf(submission)
  const marker = state.requests.get(submission.requestId)

  if (marker) {
    if (marker.fingerprint !== fingerprint) return refused(refuse('request-conflict', 'This request ID was used with different content'))
    const existing = state.operations.get(marker.operation)

    return existing ? [step(existing), state] : refused(refuse('result-expired', 'The operation for this request is no longer kept'))
  }

  if (submission.instanceId !== rules.instanceId) return refused(refuse('instance-changed', 'Cria restarted: this request was for an earlier instance'))
  const device = rules.devices.get(submission.deviceId)

  if (!device) return refused(refuse('request-error', `Unknown device ${submission.deviceId}`))
  const runsOn = commands[submission.kind].device

  if (runsOn !== 'any' && runsOn !== device.kind) return refused(refuse('request-error', `A ${device.kind} cannot run ${submission.kind}`))
  if (!rules.commandsEnabled) return refused(refuse('commands-disabled', 'Commands are disabled'))

  const accepted = { ...submission, id, failureDomain: device.failureDomain, acceptedAt: now }
  const open = openIn(state, device.failureDomain)
  const record = (operation: Open, after: ReadonlyArray<After>): Transition<Operation> => [
    step(operation, after),
    changed(state, {
      operations: put(state.operations, operation.id, operation),
      requests: put(state.requests, operation.requestId, { fingerprint, operation: operation.id }),
    }),
  ]
  const start = () => {
    const running: Running = { ...accepted, state: 'running', startedAt: now, progress: initialProgress }

    return record(running, [{ kind: 'start', operation: running }])
  }

  if (isHalt(accepted)) {
    if (open.length === 0) return start()
    const running = open.find((operation): operation is Running => operation.state === 'running')

    return record({ ...accepted, state: 'waiting' }, running && !isHalt(running) ? [{ kind: 'stop', operation: running }] : [])
  }

  if (open.length > 0) return refused(refuse('device-busy', 'The device is running another operation'))

  return start()
}

function progress(state: LedgerState, input: { readonly id: OperationId; readonly progress: Progress }): Transition<void> {
  const operation = state.operations.get(input.id)

  if (operation?.state !== 'running') return [step(undefined), state]

  return [step(undefined), changed(state, { operations: put(state.operations, operation.id, { ...operation, progress: input.progress }) })]
}

/** A running operation, ended. `settle` and the announcement of a settle both build it here. */
function endedOf(
  operation: Running,
  input: { readonly outcome: Outcome<OperationResult>; readonly settledAt: number; readonly motion?: MotionRecord | undefined },
): Ended {
  const { progress: _, ...started } = operation

  return { ...started, state: 'settled', settledAt: input.settledAt, outcome: input.outcome, ...(input.motion === undefined ? {} : { motion: input.motion }) }
}

export function settle(
  rules: Rules,
  state: LedgerState,
  input: { readonly id: OperationId; readonly outcome: Outcome<OperationResult>; readonly settledAt: number; readonly now: number; readonly motion?: MotionRecord | undefined },
): Transition<void> {
  const operation = state.operations.get(input.id)

  if (operation?.state !== 'running') return [step(undefined), state]
  const ended = endedOf(operation, input)
  const next = openIn(state, operation.failureDomain).find((open): open is Waiting => open.state === 'waiting')
  const following: Running | undefined = next && { ...next, state: 'running', startedAt: input.now, progress: initialProgress }
  const operations = put(state.operations, ended.id, ended)
  const settledState = prune(
    rules,
    changed(state, {
      operations: following ? put(operations, following.id, following) : operations,
      waiters: new Map([...state.waiters].filter(([id]) => id !== ended.id)),
    }),
  )
  const waiters = state.waiters.get(ended.id) ?? []
  const resolve: ReadonlyArray<After> = waiters.length > 0 ? [{ kind: 'resolve', waiters, operation: ended }] : []
  const start: ReadonlyArray<After> = following ? [{ kind: 'start', operation: following }] : []

  return [step(undefined, [...resolve, ...start]), settledState]
}

export function prune(rules: Rules, state: LedgerState): LedgerState {
  const finished = [...state.operations.values()].filter(operation => operation.state === 'settled')
  const excess = finished.length - rules.history

  if (excess <= 0) return state
  const dropped = new Set(finished.slice(0, excess).map(operation => operation.id))

  return { ...state, operations: new Map([...state.operations].filter(([id]) => !dropped.has(id))) }
}

export function cancel(state: LedgerState, id: OperationId): Transition<Operation | Refusal> {
  const operation = state.operations.get(id)

  if (!operation) return [step(missing(state, id)), state]

  return [step(operation, operation.state === 'running' && !isHalt(operation) ? [{ kind: 'stop', operation }] : []), state]
}

export function wait(state: LedgerState, input: { readonly id: OperationId; readonly waiter: Deferred.Deferred<Settled> }): Transition<void | Refusal> {
  const operation = state.operations.get(input.id)

  if (!operation) return [step(missing(state, input.id)), state]
  if (operation.state === 'settled') return [step(undefined, [{ kind: 'resolve', waiters: [input.waiter], operation }]), state]

  return [step(undefined), { ...state, waiters: put(state.waiters, input.id, [...(state.waiters.get(input.id) ?? []), input.waiter]) }]
}

export function snapshot(rules: Rules, state: LedgerState): Transition<LedgerSnapshot> {
  const all = [...state.operations.values()]
  const hidden = new Set<Operation>(all.filter(operation => operation.state === 'settled').slice(0, -settledShown))
  const next = { ...state, sequence: state.sequence + 1 }

  return [
    step({
      sequence: next.sequence,
      revision: state.revision,
      operations: all.filter(operation => !hidden.has(operation)),
      busy: failureDomain => openIn(state, failureDomain).length > 0,
    }),
    next,
  ]
}

function find(state: LedgerState, id: OperationId): Operation | Refusal {
  const operation = state.operations.get(id)

  return operation ? operation : missing(state, id)
}

function byRequest(rules: Rules, state: LedgerState, instanceId: InstanceId, requestId: RequestId): Operation | Refusal {
  const marker = instanceId === rules.instanceId ? state.requests.get(requestId) : undefined

  return marker ? find(state, marker.operation) : refuse('not-found', 'No such request')
}

function fingerprintOf(submission: Submission): string {
  const sorted = (value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sorted(inner)]))
      : value

  return JSON.stringify(sorted({ ...submission, instanceId: undefined }))
}

export interface LedgerDevice extends Placement {
  /** `note` keeps the latest motion record of this operation, which settles with it whatever its outcome. */
  readonly work: (operation: Running, report: Report<Progress>, note: (record: MotionRecord) => Effect.Effect<void>) => Effect.Effect<OperationResult, Ending>
}

export interface Ledger {
  readonly submit: (submission: Submission) => Effect.Effect<Operation, Refusal>
  readonly cancel: (id: OperationId) => Effect.Effect<Operation, Refusal>
  readonly operation: (id: OperationId) => Effect.Effect<Operation, Refusal>
  readonly request: (instanceId: InstanceId, requestId: RequestId) => Effect.Effect<Operation, Refusal>
  readonly awaitSettled: (id: OperationId) => Effect.Effect<Settled, Refusal>
  readonly snapshot: Effect.Effect<LedgerSnapshot>
  readonly revisions: Stream.Stream<number>
}

export interface LedgerOptions {
  readonly instanceId: InstanceId
  readonly commandsEnabled: boolean
  readonly history: number
  readonly devices: ReadonlyArray<LedgerDevice>
  /**
   * Called once, right after an operation settles, with the operation as the
   * ledger now holds it. Must return at once and not throw.
   */
  readonly onSettled?: (operation: Settled) => void
}

const answer = <A>(result: A | Refusal): Effect.Effect<A, Refusal> => (result instanceof Refusal ? Effect.fail(result) : Effect.succeed(result))

export function makeLedger(options: LedgerOptions): Effect.Effect<Ledger, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const devices = new Map(options.devices.map(device => [device.id, device]))
    const rules: Rules = { instanceId: options.instanceId, commandsEnabled: options.commandsEnabled, history: options.history, devices }
    const domainIds = [...new Set(options.devices.map(device => device.failureDomain))]
    const state = yield* Ref.make(initialState())
    const motions = new Map<OperationId, MotionRecord>()
    const revisions = yield* Effect.acquireRelease(PubSub.sliding<number>(1), PubSub.shutdown)
    const runs = new Map(
      yield* Effect.forEach(domainIds, id =>
        Effect.map(
          makeRun<Running, Progress, OperationResult, OperationId>({
            initial: () => initialProgress,
            work: (operation, report) =>
              Effect.suspend(() => known(devices, operation.deviceId).work(operation, report, record => Effect.sync(() => void motions.set(operation.id, record)))),
          }),
          run => [id, run] as const,
        ),
      ),
    )

    const apply = <A>(transition: (current: LedgerState) => Transition<A>): Effect.Effect<A> =>
      Ref.modify(state, current => {
        const [done, next] = transition(current)

        return [{ done, revision: next.revision === current.revision ? undefined : next.revision }, next] as const
      }).pipe(
        Effect.tap(({ done, revision }) =>
          Effect.andThen(Effect.forEach(done.after, perform, { discard: true }), revision === undefined ? Effect.void : PubSub.publish(revisions, revision)),
        ),
        Effect.map(({ done }) => done.result),
      )

    // Settling is the one transition whose result callers also want announced; the pure `settle` stays as it is.
    const settleAndAnnounce = (input: {
      readonly id: OperationId
      readonly outcome: Outcome<OperationResult>
      readonly settledAt: number
      readonly now: number
      readonly motion?: MotionRecord | undefined
    }) => {
      let announced: Settled | undefined

      return apply(current => {
        const transition = settle(rules, current, input)
        const running = current.operations.get(input.id)

        // Not read back from the new state: `settle` prunes by age, so an old operation can be gone from it already.
        announced = running?.state === 'running' ? endedOf(running, input) : undefined

        return transition
      }).pipe(Effect.andThen(Effect.sync(() => announced && options.onSettled?.(announced))))
    }

    function perform(after: After): Effect.Effect<void> {
      switch (after.kind) {
        case 'start': {
          const { operation } = after

          return known(runs, operation.failureDomain)
            .start(operation.id, operation)
            .pipe(
              Effect.catchTag('Failed', refused =>
                settleAndAnnounce({
                  id: operation.id,
                  outcome: { kind: 'uncertain', reason: 'unexpected-error', message: `Run refused a start the ledger reserved: ${refused.message}` },
                  settledAt: Date.now(),
                  now: Date.now(),
                }),
              ),
            )
        }
        case 'stop':
          return Effect.asVoid(Effect.forkIn(known(runs, after.operation.failureDomain).stop(after.operation.id), scope))
        case 'resolve':
          return Effect.forEach(after.waiters, waiter => Deferred.succeed(waiter, after.operation), { discard: true })
      }
    }

    const follow = (update: RunView<Progress, OperationResult, OperationId>) => {
      if (update.state === 'idle') return Effect.void
      if (update.state === 'running') return apply(current => progress(current, { id: update.runId, progress: update.progress }))
      const now = Date.now()
      const motion = motions.get(update.runId)

      motions.delete(update.runId)

      return settleAndAnnounce({ id: update.runId, outcome: update.outcome, settledAt: update.settledAt, now, motion })
    }

    for (const run of runs.values()) yield* Effect.forkIn(Stream.runForEach(run.changes, follow), scope)

    const read = <A>(query: (current: LedgerState) => A | Refusal) => Effect.flatMap(Ref.get(state), current => answer(query(current)))

    return {
      submit: submission =>
        Effect.gen(function* () {
          const input = { submission, id: mint.operationId(), now: Date.now() }

          return yield* answer(yield* apply(current => admit(rules, current, input)))
        }),
      cancel: id => Effect.flatMap(apply(current => cancel(current, id)), answer),
      operation: id => read(current => find(current, id)),
      request: (instanceId, requestId) => read(current => byRequest(rules, current, instanceId, requestId)),
      awaitSettled: id =>
        Effect.gen(function* () {
          const waiter = yield* Deferred.make<Settled>()

          yield* answer(yield* apply(current => wait(current, { id, waiter })))

          return yield* Deferred.await(waiter)
        }),
      snapshot: apply(current => snapshot(rules, current)),
      revisions: Stream.fromPubSub(revisions),
    }
  })
}
