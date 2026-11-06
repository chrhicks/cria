#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { makeIndiClient, type TrafficTap } from '@cria/indi'
import { connect } from '@nats-io/transport-node'
import { Effect } from 'effect'
import { ClientConfig } from './config.js'
import { makeDebugChangeFilter } from './debug-lines.js'
import { makeEntries, type Entry } from './entry.js'
import { followJournal } from './journal.js'
import { followPhd2 } from './phd2.js'
import { wireSubject } from './subjects.js'

const config = await Effect.runPromise(Effect.provide(Effect.service(ClientConfig), ClientConfig.layer))

const broker = await connect({
  ...config.broker,
  name: 'rig-stream-client',
  waitOnFirstConnect: true,
  maxReconnectAttempts: -1,
})

console.error(`rig-stream-client: broker connected, ${broker.getServer()}`)

void (async () => {
  for await (const status of broker.status()) console.error(`rig-stream-client: broker ${status.type}`)
})()

function publish(subject: string, entry: Entry) {
  try {
    broker.publish(subject, JSON.stringify(entry))
  } catch (error) {
    console.error(`rig-stream-client: publish failed: ${String(error)}`)
  }
}

const entries = makeEntries({
  rig: config.rig,
  source: `${hostname()}:stream-client`,
  run: randomUUID(),
  now: () => Date.now(),
})

const debugLines = makeDebugChangeFilter()

const tap: TrafficTap = {
  message: ({ conn, dir, xml }) => {
    for (const line of debugLines.pass(xml)) publish(wireSubject(config.wireDevices, dir, line), entries.wire(conn, dir, line))
  },
  connection: connection => {
    debugLines.forget()
    console.error(`rig-stream-client: indiserver ${connection.status}${connection.status === 'closed' ? `: ${connection.error}` : ''}`)
  },
}

await Promise.all([
  Effect.runPromise(Effect.scoped(Effect.andThen(makeIndiClient({ ...config.indi, tap }), Effect.never))),
  followJournal(config.journalExclusions, config.journalCursorFile, async line => {
    broker.publish('rig-dev.system', JSON.stringify(entries.system(line)))
    await broker.flush()
  }),
  followPhd2(
    config.phd2,
    line => publish('rig-dev.phd2', entries.phd2(line)),
    status => console.error(`rig-stream-client: phd2 ${status}`),
  ),
])
