import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { Effect, Option, Schema, Scope } from 'effect'
import type { TrafficTap } from '../indi/index.ts'
import { BrokerLogin, brokerSettings, defaultWireDevices, makeEntries, openPublisher, wireDevice, type BrokerSettings, type Publisher } from '../stream/index.ts'
import type { ConnectRequest, ConnectResult, InstanceId } from './wire.ts'
import type { Config } from './config.ts'

const StreamSettings = Schema.fromJsonString(
  Schema.Struct({
    rig: Schema.optionalKey(Schema.String),
    wireDevices: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    broker: BrokerLogin,
  }),
)

export interface CriaStream {
  readonly request: (request: ConnectRequest) => void
  readonly settled: (request: ConnectRequest, result: ConnectResult) => void
  readonly traffic: TrafficTap
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
    const publisher = open(read.value.broker, connection =>
      publisher.publish('rig-dev.client', entries.client('connected', { client: 'cria', run: instanceId, connection, sources: ['cria'] })),
    )

    yield* Effect.addFinalizer(() => Effect.promise(() => publisher.close()))

    return {
      request: ({ deviceId, connected }) =>
        publisher.publish('rig-dev.cria.request', entries.cria('request', { deviceId, kind: 'device-connect', connected, result: 'accepted' })),
      settled: ({ deviceId, connected }, { outcome, ...detail }) =>
        publisher.publish('rig-dev.cria.settled', entries.cria('settled', { deviceId, kind: 'device-connect', connected, outcome: { kind: outcome, ...detail } })),
      traffic: {
        connection: () => {},
        message: ({ conn, dir, xml }) => {
          if (dir !== 'out' || !xml.startsWith('<new')) return

          publisher.publish('rig-dev.cria.write', entries.cria('write', { device: wireDevice(wireDevices, xml), property: firstTagName.exec(xml)?.[1] ?? '', conn, xml }))
        },
      },
    }
  })
}
