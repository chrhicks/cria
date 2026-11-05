import { readFileSync } from 'node:fs'
import { Config, ConfigProvider, Context, Effect, Layer, Schema } from 'effect'

const Broker = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
  user: Schema.String.annotate({ description: 'Broker login for this program' }),
  pass: Schema.String.annotate({ description: 'Password for that login. Keep the file private' }),
})

const ClientSettings = Schema.Struct({
  indi: Schema.Struct({
    host: Schema.String.annotate({ description: 'Where indiserver listens' }),
    port: Schema.Number.annotate({ description: 'indiserver port' }),
  }),
  broker: Broker,
})

const ViewerSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the page is served on' }),
  broker: Broker,
  streamMaxAgeDays: Schema.Number.annotate({
    description: 'Days the dev stream keeps messages. Throwaway data: long enough to look back across a few iterations, at about 125 MB a day',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(7))),
  messagesShownOnOpen: Schema.Number.annotate({
    description: 'Messages a newly opened page shows at once: enough to fill a screen before live messages arrive',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(200))),
  rowsKeptOnPage: Schema.Number.annotate({
    description: 'Rows one page keeps so a tab left open stays responsive: about 6 minutes of the idle rig. Not measured',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(2000))),
})

const fileNamedOnCommandLine = Layer.suspend(() => {
  const path = process.argv[2]

  if (!path) return Layer.effectDiscard(Effect.die('usage: <program> <config.json>'))

  return ConfigProvider.layer(ConfigProvider.fromUnknown(JSON.parse(readFileSync(path, 'utf8'))))
})

export class ClientConfig extends Context.Service<ClientConfig, typeof ClientSettings.Type>()('rig-stream/ClientConfig') {
  static readonly layer = Layer.effect(ClientConfig)(Effect.gen(function* () {
    return yield* Config.schema(ClientSettings)
  })).pipe(Layer.provide(fileNamedOnCommandLine))
}

export class ViewerConfig extends Context.Service<ViewerConfig, typeof ViewerSettings.Type>()('rig-stream/ViewerConfig') {
  static readonly layer = Layer.effect(ViewerConfig)(Effect.gen(function* () {
    return yield* Config.schema(ViewerSettings)
  })).pipe(Layer.provide(fileNamedOnCommandLine))
}
