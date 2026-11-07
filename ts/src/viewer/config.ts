import { Config, Context, Effect, Layer, Schema } from 'effect'
import { BrokerLogin, fileNamedOnCommandLine } from '../stream/index.ts'

const ViewerSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the page is served on' }),
  broker: BrokerLogin,
  historyReadBatch: Schema.Number.annotate({
    description: 'Entries asked of the broker at a time when reading history. The client library defaults to 100; 2048 read 200,000 entries in 0.8 s on thuban, 2026-11-06',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(2048))),
  rowsKeptOnPage: Schema.Number.annotate({
    description: 'Newest matching entries sent to one page and kept on it, so a tab stays responsive: about 7 minutes of the idle rig at 280 a minute. The page\'s own speed at this size was not measured',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(2000))),
})

export class ViewerConfig extends Context.Service<ViewerConfig, typeof ViewerSettings.Type>()('viewer/ViewerConfig') {
  static readonly layer = Layer.effect(ViewerConfig)(Effect.gen(function* () {
    return yield* Config.schema(ViewerSettings)
  })).pipe(Layer.provide(fileNamedOnCommandLine))
}
