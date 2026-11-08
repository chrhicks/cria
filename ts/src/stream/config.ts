import { homedir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { described } from '../config.ts'
import { BrokerLogin } from './broker.ts'

export const StreamSettings = Schema.Struct({
  rig: described('The rig each entry belongs to: the id Vela already uses for it', Schema.String, 'fra-cria'),
  broker: BrokerLogin,
  journalExclusions: described(
    'Which journal lines stay off the stream',
    Schema.Struct({
      identifiers: described('Log sources left off the stream. Chris, 2026-11-04: ssh sessions and Tailscale routes are off', Schema.Array(Schema.String), ['sshd', 'sshd-session', 'systemd-logind', 'tailscaled']),
      unitPrefixes: described('Units left off the stream. session- is an ssh session', Schema.Array(Schema.String), ['session-']),
    }),
    {},
  ),
  journalCursorFile: described(
    'Remembers the last journal line sent, on disk, so lines written while the rig program was down, such as a boot after a power cut, still reach the stream',
    Schema.String,
    join(homedir(), '.local', 'state', 'rig-stream', 'journal-cursor'),
  ),
  phd2: described(
    'Where the rig program follows PHD2',
    Schema.Struct({
      host: described("Where PHD2 runs. errai itself: errai's firewall closes PHD2's ports to everything else", Schema.String, '127.0.0.1'),
      port: described("PHD2's event server: 4400 for its first instance, set by PHD2", Schema.Number, 4400),
      reconnectSeconds: described(
        'How soon to look for PHD2 again after it goes away. PHD2 is not always running next to the rig program: errai\'s journal shows 19 starts of phd2.service between 2026-10-25 and 11-06, 8 of them on 11-06 (development days and reboots), so the rig program follows PHD2 instead of exiting with it. Matches RestartSec in phd2.service, so a restarted PHD2 is picked up about when it is back',
        Schema.Number,
        5,
      ),
    }),
    {},
  ),
})

export type StreamSettings = typeof StreamSettings.Type
