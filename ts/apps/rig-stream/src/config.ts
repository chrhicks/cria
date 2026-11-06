import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Config, ConfigProvider, Context, Effect, Layer, Schema } from 'effect'

const Broker = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
  user: Schema.String.annotate({ description: 'Broker login for this program' }),
  pass: Schema.String.annotate({ description: 'Password for that login. Keep the file private' }),
})

const ClientSettings = Schema.Struct({
  rig: Schema.String.annotate({
    description: 'The rig each entry belongs to: the id Vela already uses for it',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed('fra-cria'))),
  indi: Schema.Struct({
    host: Schema.String.annotate({ description: 'Where indiserver listens' }),
    port: Schema.Number.annotate({ description: 'indiserver port' }),
  }),
  broker: Broker,
  wireDevices: Schema.Record(Schema.String, Schema.String).annotate({
    description: 'INDI device name to the short id used in wire subjects. Cria\'s ids where one fits; Cria splits the power box into two views, and the wire has one device',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({
    'ZWO CCD ASI2600MC Pro': 'primary',
    'ZWO CCD ASI220MM Mini': 'guide',
    'ZWO EAF': 'focuser',
    'ZWO AM5': 'mount',
    'Pegasus PPBA': 'box',
  }))),
  journalExclusions: Schema.Struct({
    identifiers: Schema.Array(Schema.String).annotate({
      description: 'Log sources left off the stream. Chris, 2026-11-04: ssh sessions and Tailscale routes are off',
    }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(['sshd', 'sshd-session', 'systemd-logind', 'tailscaled']))),
    unitPrefixes: Schema.Array(Schema.String).annotate({
      description: 'Units left off the stream. session- is an ssh session. rig-stream-client is this program: publishing its own log lines would feed back into the stream',
    }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(['session-', 'rig-stream-client']))),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  journalCursorFile: Schema.String.annotate({
    description: 'Remembers the last journal line sent, on disk, so lines written while this client was down, such as a boot after a power cut, still reach the stream',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(join(homedir(), '.local', 'state', 'rig-stream', 'journal-cursor')))),
  phd2: Schema.Struct({
    host: Schema.String.annotate({
      description: 'Where PHD2 runs. errai itself: errai\'s firewall closes PHD2\'s ports to everything else',
    }).pipe(Schema.withDecodingDefaultKey(Effect.succeed('127.0.0.1'))),
    port: Schema.Number.annotate({
      description: 'PHD2\'s event server: 4400 for its first instance, set by PHD2',
    }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(4400))),
    reconnectSeconds: Schema.Number.annotate({
      description: 'How soon to look for PHD2 again after it goes away. Matches RestartSec in phd2.service, so a restarted PHD2 is picked up about when it is back',
    }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(5))),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
})

const ViewerSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the page is served on' }),
  broker: Broker,
  streamMaxAgeDays: Schema.Number.annotate({
    description: 'Days the dev stream keeps messages. Throwaway data: long enough to look back across a few iterations, at about 230 MB a day idle, estimated from the 125 MB measured before the entry format',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(7))),
  historyReadBatch: Schema.Number.annotate({
    description: 'Entries asked of the broker at a time when reading history. The client library defaults to 100; 2048 read 200,000 entries in 0.8 s on thuban, 2026-11-06',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(2048))),
  rowsKeptOnPage: Schema.Number.annotate({
    description: 'Newest matching entries sent to one page and kept on it, so a tab stays responsive: about 7 minutes of the idle rig at 280 a minute. The page\'s own speed at this size was not measured',
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
