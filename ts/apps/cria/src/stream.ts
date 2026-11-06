import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { Effect, Option, Schema, Scope } from 'effect'
import { makeEntries, openPublisher, type BrokerSettings, type Publisher } from '@cria/stream'
import type { InstanceId, Operation } from '@cria/wire'
import type { Config } from './config.js'
import type { Submission } from './operation/ledger.js'
import type { Refusal } from './refusal.js'

type Settled = Extract<Operation, { readonly state: 'settled' }>

const StreamSettings = Schema.fromJsonString(
  Schema.Struct({
    rig: Schema.optionalKey(Schema.String),
    broker: Schema.Struct({ servers: Schema.String, user: Schema.String, pass: Schema.String }),
  }),
)

export interface CriaStream {
  readonly accepted: (submission: Submission, operation: Operation) => void
  readonly refused: (submission: Submission, refusal: Refusal) => void
  readonly settled: (operation: Settled) => void
}

export type OpenPublisher = (broker: BrokerSettings, onConnected: (connection: number) => void) => Publisher

function asked({ bindingId: _binding, expectedName: _name, leaseId: _lease, ...kept }: Submission) {
  return kept
}

export function makeCriaStream(
  config: Config,
  instanceId: InstanceId,
  open: OpenPublisher = (broker, onConnected) =>
    openPublisher({ broker, name: 'cria', log: line => console.error(`cria: stream: ${line}`), onConnected }),
): Effect.Effect<CriaStream | undefined, never, Scope.Scope> {
  const file = config.streamClientConfig

  if (file === undefined) return Effect.succeed(undefined)

  return Effect.gen(function* () {
    const read = yield* Effect.option(
      Effect.try(() => Schema.decodeUnknownSync(StreamSettings)(readFileSync(file, 'utf8'))),
    )

    if (Option.isNone(read)) {
      yield* Effect.logWarning(`stream settings at ${file} could not be read: not publishing`)

      return undefined
    }

    const entries = makeEntries({
      rig: read.value.rig ?? 'fra-cria',
      source: `${hostname()}:cria`,
      run: instanceId,
      now: () => Date.now(),
    })
    const build = spawnSync('git', ['-C', import.meta.dirname, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
    const version = build.status === 0 ? build.stdout.trim() : 'unknown'
    const publisher = open(read.value.broker, connection =>
      publisher.publish(
        'rig-dev.client',
        entries.client('connected', { client: 'cria', run: instanceId, connection, version, sources: ['cria'] }),
      ),
    )

    yield* Effect.addFinalizer(() => Effect.promise(() => publisher.close()))

    return {
      accepted: (submission, operation) =>
        publisher.publish('rig-dev.cria.request', entries.cria('request', { ...asked(submission), result: 'accepted', operationId: operation.id })),
      refused: (submission, refusal) =>
        publisher.publish('rig-dev.cria.request', entries.cria('request', { ...asked(submission), result: 'refused', code: refusal.code, message: refusal.message })),
      settled: ({ bindingId: _binding, expectedName: _name, leaseId: _lease, failureDomain: _domain, recovery: _recovery, ...operation }) =>
        publisher.publish('rig-dev.cria.settled', entries.cria('settled', operation)),
    }
  })
}
