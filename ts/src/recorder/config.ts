import { homedir } from 'node:os'
import { join } from 'node:path'
import { Config, Context, Effect, Layer, Schema } from 'effect'
import { defaultRigFile } from '../rig/file.ts'
import { BrokerLogin, fileNamedOnCommandLine } from '../stream/index.ts'

const RecorderSettings = Schema.Struct({
  rig: Schema.String.annotate({
    description: 'The rig each entry belongs to: the id Vela already uses for it',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed('fra-cria'))),
  indi: Schema.Struct({
    host: Schema.String.annotate({ description: 'Where indiserver listens' }),
    port: Schema.Number.annotate({ description: 'indiserver port' }),
  }),
  broker: BrokerLogin,
  rigFile: Schema.String.annotate({
    description: 'The rig file on this machine. Wire subjects name each INDI device by its id there, so the recorder and the rig program can never disagree about what the devices are called',
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultRigFile))),
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

export class RecorderConfig extends Context.Service<RecorderConfig, typeof RecorderSettings.Type>()('recorder/RecorderConfig') {
  static readonly layer = Layer.effect(RecorderConfig)(Effect.gen(function* () {
    return yield* Config.schema(RecorderSettings)
  })).pipe(Layer.provide(fileNamedOnCommandLine))
}
