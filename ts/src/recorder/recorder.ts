import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { makeIndiClient, type TrafficTap } from '../indi/index.ts'
import { brokerSettings, makeEntries, openPublisher, refreshSubject, wireSubject } from '../stream/index.ts'
import { Effect } from 'effect'
import { RecorderConfig } from './config.ts'
import { makeDebugChangeFilter } from './debug-lines.ts'
import { followJournal } from './journal.ts'
import { followPhd2 } from './phd2.ts'

export async function runRecorder(): Promise<void> {
  const config = await Effect.runPromise(Effect.provide(Effect.service(RecorderConfig), RecorderConfig.layer))

  const run = randomUUID()

  const entries = makeEntries({
    rig: config.rig,
    source: `${hostname()}:stream-client`,
    run,
    now: () => Date.now(),
  })

  const build = spawnSync('git', ['-C', import.meta.dirname, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  const version = build.status === 0 ? build.stdout.trim() : 'unknown'

  const broker = openPublisher({
    broker: brokerSettings(config.broker),
    name: 'rig-stream-client',
    log: line => console.error(`rig-stream-client: ${line}`),
    onConnected: connection =>
      broker.publish(
        'rig-dev.client',
        entries.client('connected', {
          client: 'stream-client',
          run,
          connection,
          version,
          sources: ['wire', 'system', 'phd2'],
          wireDevices: config.wireDevices,
        }),
      ),
  })

  const debugLines = makeDebugChangeFilter()

  const tap: TrafficTap = {
    message: ({ conn, dir, xml }) => {
      for (const line of debugLines.pass(xml)) broker.publish(wireSubject(config.wireDevices, dir, line), entries.wire(conn, dir, line))
    },
    connection: connection => {
      debugLines.forget()
      broker.publish('rig-dev.client', entries.client('connection', { target: 'indiserver', conn: connection.conn, status: connection.status, ...(connection.status === 'closed' ? { error: connection.error } : {}) }))
      console.error(`rig-stream-client: indiserver ${connection.status}${connection.status === 'closed' ? `: ${connection.error}` : ''}`)
    },
  }

  await broker.ready

  await Promise.all([
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(makeIndiClient({ ...config.indi, tap }), indi => {
          broker.listen(refreshSubject, () => {
            Effect.runFork(indi.refresh.pipe(Effect.tapError(error => Effect.sync(() => console.error(`rig-stream-client: refresh not sent: ${error.message}`)))))
          })

          return Effect.never
        }),
      ),
    ),
    followJournal(config.journalExclusions, config.journalCursorFile, async line => {
      await broker.publishConfirmed('rig-dev.system', entries.system(line))
    }),
    followPhd2(
      config.phd2,
      line => broker.publish('rig-dev.phd2', entries.phd2(line)),
      status => {
        console.error(`rig-stream-client: phd2 ${JSON.stringify(status)}`)
        broker.publish('rig-dev.client', entries.client('connection', { target: 'phd2', ...status }))
      },
    ),
  ])
}
