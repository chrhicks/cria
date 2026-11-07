import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { Effect, Option, Schema, Scope } from 'effect'
import type { TrafficTap } from '@cria/indi'
import { BrokerLogin, brokerSettings, defaultWireDevices, makeEntries, openPublisher, wireDevice, type BrokerSettings, type Publisher } from '@cria/stream'
import type { InstanceId, Operation } from '@cria/wire'
import type { Config } from './config.js'
import type { Submission } from './operation/ledger.js'
import type { FrameKept } from './operation/workflows.js'
import type { Refusal } from './refusal.js'

type Settled = Extract<Operation, { readonly state: 'settled' }>

const StreamSettings = Schema.fromJsonString(
  Schema.Struct({
    rig: Schema.optionalKey(Schema.String),
    wireDevices: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    broker: BrokerLogin,
  }),
)

export interface CriaStream {
  readonly accepted: (submission: Submission, operation: Operation) => void
  readonly refused: (submission: Submission, refusal: Refusal) => void
  readonly settled: (operation: Settled) => void
  readonly traffic: TrafficTap
  readonly frame: (frame: FrameKept) => void
}

const firstTagName = /^\s*<[^>]*?\bname="([^"]*)"/

export type OpenPublisher = (broker: BrokerSettings, onConnected: (connection: number) => void) => Publisher

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
      Effect.try(() => {
        const settings = Schema.decodeUnknownSync(StreamSettings)(readFileSync(file, 'utf8'))

        return { ...settings, broker: brokerSettings(settings.broker) }
      }),
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
    const wireDevices = read.value.wireDevices ?? defaultWireDevices
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
        publisher.publish('rig-dev.cria.request', entries.cria('request', { ...submission, result: 'accepted', operationId: operation.id })),
      refused: (submission, refusal) =>
        publisher.publish('rig-dev.cria.request', entries.cria('request', { ...submission, result: 'refused', code: refusal.code, message: refusal.message })),
      frame: frame => publisher.publish('rig-dev.cria.frame', entries.cria('frame', frame)),
      traffic: {
        connection: () => {},
        message: ({ conn, dir, xml }) => {
          if (dir !== 'out' || !xml.startsWith('<new')) return

          publisher.publish('rig-dev.cria.write', entries.cria('write', { device: wireDevice(wireDevices, xml), property: firstTagName.exec(xml)?.[1] ?? '', conn, xml }))
        },
      },
      settled: operation =>
        publisher.publish('rig-dev.cria.settled', entries.cria('settled', operation)),
    }
  })
}
