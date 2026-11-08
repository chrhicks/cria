import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { TrafficTap } from '../indi/index.ts'
import { brokerSettings } from './broker.ts'
import type { StreamSettings } from './config.ts'
import { makeEntries } from './entry.ts'
import { followJournal } from './journal.ts'
import { followPhd2 } from './phd2.ts'
import { openPublisher } from './publisher.ts'
import { keepRunning } from './retry.ts'
import { wireDeviceId, wireSubject } from './subjects.ts'

export interface Recording {
  readonly tap: TrafficTap
  readonly running: Promise<unknown>
}

export function startRecording(options: {
  readonly settings: StreamSettings
  readonly wireDevices: Readonly<Record<string, string>>
  readonly log: (line: string) => void
  readonly onBrokerConnected: () => void
}): Recording {
  const { settings, wireDevices } = options
  const log = (line: string) => options.log(`rig: ${line}`)
  const run = randomUUID()
  const entries = makeEntries({ rig: settings.rig, source: `${hostname()}:rig`, run, now: Date.now })
  const build = spawnSync('git', ['-C', import.meta.dirname, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  const version = build.status === 0 ? build.stdout.trim() : 'unknown'

  const broker = openPublisher({
    broker: () => brokerSettings(settings.broker),
    name: 'rig',
    log,
    retryMs: settings.retrySeconds * 1000,
    onConnected: connection => {
      broker.publish('rig-dev.client', entries.client('connected', { client: 'rig', run, connection, version, sources: ['wire', 'system', 'phd2'], wireDevices }))
      options.onBrokerConnected()
    },
  })

  const tap: TrafficTap = {
    message: message => {
      const device = wireDeviceId(wireDevices, message.facts)

      broker.publish(wireSubject(device, message.dir), entries.wire(message, device))
    },
    problem: problem => broker.publish('rig-dev.client', entries.protocolProblem(problem)),
    connection: connection => {
      broker.publish(
        'rig-dev.client',
        entries.client('connection', { target: 'indiserver', status: connection.status, ...(connection.status === 'closed' ? { error: connection.error } : {}) }),
      )
    },
  }

  const running = Promise.all([
    keepRunning({
      name: 'journal',
      retryMs: settings.retrySeconds * 1000,
      log,
      run: healthy => followJournal(settings.journalExclusions, settings.journalCursorFile, line => broker.store('rig-dev.system', entries.system(line)), 'journalctl', healthy),
    }),
    followPhd2(
      settings.phd2,
      line => broker.publish('rig-dev.phd2', entries.phd2(line)),
      status => {
        log(`phd2 ${JSON.stringify(status)}`)
        broker.publish('rig-dev.client', entries.client('connection', { target: 'phd2', ...status }))
      },
    ),
  ])

  return { tap, running }
}
