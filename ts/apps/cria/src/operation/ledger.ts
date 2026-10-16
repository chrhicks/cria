/** Run (+ history), Quarantine: the one owner of operations, per rig (docs/ts/SPEC.md, "New primitive: Quarantine"). */
import { Deferred, Effect, PubSub, Ref, Scope, Stream } from 'effect'
import { makeRun, quarantineOf, type Ending, type ExternalRecovery, type Outcome, type QuarantineState, type Report, type RunView } from '@cria/primitives'
import {
  commands,
  isHalt,
  type BindingId,
  type Command,
  type DeviceId,
  type DeviceKind,
  type FailureDomain,
  type InstanceId,
  type Operation,
  type OperationId,
  type OperationResult,
  type Progress,
  type RequestId,
} from '@cria/wire'
import { mint } from '../ids.js'
import { Refusal, refuse } from '../refusal.js'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type Stored = DistributiveOmit<Operation, 'recovery'>
export type Running = Extract<Stored, { readonly state: 'running' }>
type Waiting = Extract<Stored, { readonly state: 'waiting' }>
type Ended = Extract<Stored, { readonly state: 'settled' }>
type Open = Running | Waiting
type Settled = Extract<Operation, { readonly state: 'settled' }>
type Recovery = NonNullable<Settled['recovery']>

export type Submission = Command & {
  readonly instanceId: InstanceId
  readonly requestId: RequestId
  readonly deviceId: DeviceId
  readonly bindingId: BindingId
  readonly expectedName: string
}

export interface Placement {
  readonly id: DeviceId
  readonly kind: DeviceKind
  readonly name: string
  readonly failureDomain: FailureDomain
}

export interface Rules {
  readonly instanceId: InstanceId
  readonly commandsEnabled: boolean
  readonly history: number
  readonly devices: ReadonlyMap<DeviceId, Placement>
}

export interface SettledMark {
  readonly id: OperationId
  readonly settledAt: number
}

interface Domain {
  readonly binding: BindingId
  readonly recentlySettled: ReadonlyArray<SettledMark>
}

export interface LedgerState {
  readonly operations: ReadonlyMap<OperationId, Stored>
  readonly requests: ReadonlyMap<RequestId, { readonly fingerprint: string; readonly operation: OperationId }>
  readonly domains: ReadonlyMap<FailureDomain, Domain>
  readonly recoveredBindings: ReadonlyMap<BindingId, Recovery>
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

export interface DomainFacts {
  readonly binding: BindingId
  readonly quarantine: QuarantineState
  readonly busy: boolean
  readonly recentlySettled: ReadonlyArray<SettledMark>
}

export interface LedgerSnapshot {
  readonly sequence: number
  readonly revision: number
  readonly operations: ReadonlyArray<Operation>
  readonly facts: (failureDomain: FailureDomain) => DomainFacts
}

const initialProgress: Progress = { phase: 'preparing', elapsedSeconds: null }

const settledKept = 16
const settledShown = 20

export function initialState(bindings: Iterable<readonly [FailureDomain, BindingId]>): LedgerState {
  return {
    operations: new Map(),
    requests: new Map(),
    domains: new Map([...bindings].map(([domain, binding]) => [domain, { binding, recentlySettled: [] }])),
    recoveredBindings: new Map(),
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

function quarantineIn(state: LedgerState, failureDomain: FailureDomain): QuarantineState {
  const { binding } = known(state.domains, failureDomain)

  return quarantineOf([...state.operations.values()].filter((operation): operation is Ended => operation.state === 'settled' && operation.bindingId === binding))
}

const blocks = (state: LedgerState, operation: Stored) =>
  operation.state === 'settled' && operation.outcome.kind === 'uncertain' && operation.bindingId === known(state.domains, operation.failureDomain).binding

function factsOf(state: LedgerState, failureDomain: FailureDomain): DomainFacts {
  const { binding, recentlySettled } = known(state.domains, failureDomain)

  return { binding, quarantine: quarantineIn(state, failureDomain), busy: openIn(state, failureDomain).length > 0, recentlySettled }
}

const settledView = (state: LedgerState, operation: Ended): Settled => ({
  ...operation,
  recovery: operation.outcome.kind === 'uncertain' ? (state.recoveredBindings.get(operation.bindingId) ?? null) : null,
})

const view = (state: LedgerState, operation: Stored): Operation => (operation.state === 'settled' ? settledView(state, operation) : operation)

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

    return existing ? [step(view(state, existing)), state] : refused(refuse('result-expired', 'The operation for this request is no longer kept'))
  }

  if (submission.instanceId !== rules.instanceId) return refused(refuse('instance-changed', 'Cria restarted: this request was for an earlier instance'))
  const device = rules.devices.get(submission.deviceId)
  const domain = device && state.domains.get(device.failureDomain)

  if (!device || !domain) return refused(refuse('request-error', `Unknown device ${submission.deviceId}`))
  if (domain.binding !== submission.bindingId) return refused(refuse('binding-changed', 'The device binding changed; read the state again'))
  if (device.name !== submission.expectedName) return refused(refuse('binding-changed', `This device is ${device.name}`))
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

  const quarantine = quarantineIn(state, device.failureDomain)

  if (quarantine.held) return refused(refuse('device-blocked', `Blocked until recovered: ${quarantine.reason}`))
  if (open.length > 0) return refused(refuse('device-busy', 'The device is running another operation'))

  return start()
}

function progress(state: LedgerState, input: { readonly id: OperationId; readonly progress: Progress }): Transition<void> {
  const operation = state.operations.get(input.id)

  if (operation?.state !== 'running') return [step(undefined), state]

  return [step(undefined), changed(state, { operations: put(state.operations, operation.id, { ...operation, progress: input.progress }) })]
}

export function settle(
  rules: Rules,
  state: LedgerState,
  input: { readonly id: OperationId; readonly outcome: Outcome<OperationResult>; readonly settledAt: number; readonly now: number },
): Transition<void> {
  const operation = state.operations.get(input.id)

  if (operation?.state !== 'running') return [step(undefined), state]
  const { progress: _, ...started } = operation
  const ended: Ended = { ...started, state: 'settled', settledAt: input.settledAt, outcome: input.outcome }
  const domain = known(state.domains, operation.failureDomain)
  const next = openIn(state, operation.failureDomain).find((open): open is Waiting => open.state === 'waiting')
  const following: Running | undefined = next && { ...next, state: 'running', startedAt: input.now, progress: initialProgress }
  const operations = put(state.operations, ended.id, ended)
  const settledState = prune(
    rules.history,
    changed(state, {
      operations: following ? put(operations, following.id, following) : operations,
      domains: put(state.domains, operation.failureDomain, { ...domain, recentlySettled: [...domain.recentlySettled, { id: ended.id, settledAt: ended.settledAt }].slice(-settledKept) }),
      waiters: new Map([...state.waiters].filter(([id]) => id !== ended.id)),
    }),
  )
  const waiters = state.waiters.get(ended.id) ?? []
  const resolve: ReadonlyArray<After> = waiters.length > 0 ? [{ kind: 'resolve', waiters, operation: settledView(settledState, ended) }] : []
  const start: ReadonlyArray<After> = following ? [{ kind: 'start', operation: following }] : []

  return [step(undefined, [...resolve, ...start]), settledState]
}

export function prune(history: number, state: LedgerState): LedgerState {
  const finished = [...state.operations.values()].filter(operation => operation.state === 'settled' && !blocks(state, operation))
  const excess = finished.length - history

  if (excess <= 0) return state
  const dropped = new Set(finished.slice(0, excess).map(operation => operation.id))

  return { ...state, operations: new Map([...state.operations].filter(([id]) => !dropped.has(id))) }
}

export function cancel(state: LedgerState, id: OperationId): Transition<Operation | Refusal> {
  const operation = state.operations.get(id)

  if (!operation) return [step(missing(state, id)), state]

  return [step(view(state, operation), operation.state === 'running' && !isHalt(operation) ? [{ kind: 'stop', operation }] : []), state]
}

export function wait(state: LedgerState, input: { readonly id: OperationId; readonly waiter: Deferred.Deferred<Settled> }): Transition<void | Refusal> {
  const operation = state.operations.get(input.id)

  if (!operation) return [step(missing(state, input.id)), state]
  if (operation.state === 'settled') return [step(undefined, [{ kind: 'resolve', waiters: [input.waiter], operation: settledView(state, operation) }]), state]

  return [step(undefined), { ...state, waiters: put(state.waiters, input.id, [...(state.waiters.get(input.id) ?? []), input.waiter]) }]
}

export function recover(
  rules: Rules,
  state: LedgerState,
  input: {
    readonly deviceId: DeviceId
    readonly instanceId: InstanceId
    readonly bindingId: BindingId
    readonly recovery: ExternalRecovery
    readonly at: number
    readonly next: BindingId
  },
): Transition<DomainFacts | Refusal> {
  const refused = (refusal: Refusal): Transition<Refusal> => [step(refusal), state]
  const device = rules.devices.get(input.deviceId)
  const domain = device && state.domains.get(device.failureDomain)

  if (!device || !domain) return refused(refuse('not-found', `No device ${input.deviceId}`))
  if (input.instanceId !== rules.instanceId) return refused(refuse('instance-changed', 'Cria restarted'))
  if (input.bindingId !== domain.binding) return refused(refuse('binding-changed', 'The device binding changed'))
  if (openIn(state, device.failureDomain).length > 0)
    return refused(refuse('device-busy', 'An operation is still open on this device; recover it once that settles'))

  const recovered = changed(state, {
    domains: put(state.domains, device.failureDomain, { ...domain, binding: input.next }),
    recoveredBindings: put(state.recoveredBindings, domain.binding, { at: input.at, note: input.recovery.note }),
  })

  return [step(factsOf(recovered, device.failureDomain)), recovered]
}

export function snapshot(state: LedgerState): Transition<LedgerSnapshot> {
  const all = [...state.operations.values()]
  const hidden = new Set(all.filter(operation => operation.state === 'settled' && !blocks(state, operation)).slice(0, -settledShown))
  const next = { ...state, sequence: state.sequence + 1 }

  return [
    step({
      sequence: next.sequence,
      revision: state.revision,
      operations: all.filter(operation => !hidden.has(operation)).map(operation => view(state, operation)),
      facts: failureDomain => factsOf(state, failureDomain),
    }),
    next,
  ]
}

function find(state: LedgerState, id: OperationId): Operation | Refusal {
  const operation = state.operations.get(id)

  return operation ? view(state, operation) : missing(state, id)
}

function byRequest(rules: Rules, state: LedgerState, instanceId: InstanceId, requestId: RequestId): Operation | Refusal {
  const marker = instanceId === rules.instanceId ? state.requests.get(requestId) : undefined

  return marker ? find(state, marker.operation) : refuse('not-found', 'No such request')
}

function deviceFacts(rules: Rules, state: LedgerState, deviceId: DeviceId): DomainFacts | Refusal {
  const device = rules.devices.get(deviceId)

  return device ? factsOf(state, device.failureDomain) : refuse('not-found', `No device ${deviceId}`)
}

function fingerprintOf(submission: Submission): string {
  const sorted = (value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sorted(inner)]))
      : value

  return JSON.stringify(sorted({ ...submission, instanceId: undefined }))
}

export interface LedgerDevice extends Placement {
  readonly work: (operation: Running, report: Report<Progress>) => Effect.Effect<OperationResult, Ending>
}

export interface RecoverRequest {
  readonly instanceId: InstanceId
  readonly bindingId: BindingId
  readonly recovery: ExternalRecovery
}

export interface Ledger {
  readonly submit: (submission: Submission) => Effect.Effect<Operation, Refusal>
  readonly cancel: (id: OperationId) => Effect.Effect<Operation, Refusal>
  readonly operation: (id: OperationId) => Effect.Effect<Operation, Refusal>
  readonly request: (instanceId: InstanceId, requestId: RequestId) => Effect.Effect<Operation, Refusal>
  readonly awaitSettled: (id: OperationId) => Effect.Effect<Settled, Refusal>
  readonly recover: (deviceId: DeviceId, request: RecoverRequest) => Effect.Effect<DomainFacts, Refusal>
  readonly facts: (deviceId: DeviceId) => Effect.Effect<DomainFacts, Refusal>
  readonly snapshot: Effect.Effect<LedgerSnapshot>
  readonly revisions: Stream.Stream<number>
}

export interface LedgerOptions {
  readonly instanceId: InstanceId
  readonly commandsEnabled: boolean
  readonly history: number
  readonly devices: ReadonlyArray<LedgerDevice>
}

const answer = <A>(result: A | Refusal): Effect.Effect<A, Refusal> => (result instanceof Refusal ? Effect.fail(result) : Effect.succeed(result))

export function makeLedger(options: LedgerOptions): Effect.Effect<Ledger, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const devices = new Map(options.devices.map(device => [device.id, device]))
    const rules: Rules = { instanceId: options.instanceId, commandsEnabled: options.commandsEnabled, history: options.history, devices }
    const domainIds = [...new Set(options.devices.map(device => device.failureDomain))]
    const state = yield* Ref.make(initialState(domainIds.map(id => [id, mint.bindingId()])))
    const revisions = yield* Effect.acquireRelease(PubSub.sliding<number>(1), PubSub.shutdown)
    const runs = new Map(
      yield* Effect.forEach(domainIds, id =>
        Effect.map(
          makeRun<Running, Progress, OperationResult, OperationId>({
            initial: initialProgress,
            work: (operation, report) => Effect.suspend(() => known(devices, operation.deviceId).work(operation, report)),
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

    function perform(after: After): Effect.Effect<void> {
      switch (after.kind) {
        case 'start': {
          const { operation } = after

          return known(runs, operation.failureDomain)
            .start(operation.id, operation)
            .pipe(
              Effect.catchTag('Failed', refused =>
                apply(current =>
                  settle(rules, current, {
                    id: operation.id,
                    outcome: { kind: 'uncertain', reason: 'unexpected-error', message: `Run refused a start the ledger reserved: ${refused.message}` },
                    settledAt: Date.now(),
                    now: Date.now(),
                  }),
                ),
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

      return apply(current => settle(rules, current, { id: update.runId, outcome: update.outcome, settledAt: update.settledAt, now }))
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
      recover: (deviceId, request) =>
        Effect.gen(function* () {
          const input = { deviceId, ...request, at: Date.now(), next: mint.bindingId() }

          return yield* answer(yield* apply(current => recover(rules, current, input)))
        }),
      facts: deviceId => read(current => deviceFacts(rules, current, deviceId)),
      snapshot: apply(snapshot),
      revisions: Stream.fromPubSub(revisions),
    }
  })
}
