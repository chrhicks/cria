#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { makeIndiClient, type TrafficTap } from '@cria/indi'
import { makeEntries, type Entry } from '@cria/stream'
import { connect } from '@nats-io/transport-node'
import { Effect } from 'effect'
import { ClientConfig } from './config.js'
import { makeDebugChangeFilter } from './debug-lines.js'
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
  for await (const status of broker.status()) {
    console.error(`rig-stream-client: broker ${status.type}`)
    if (status.type === 'reconnect') announce()
  }
})()

function publish(subject: string, entry: Entry) {
  try {
    broker.publish(subject, JSON.stringify(entry))
  } catch (error) {
    console.error(`rig-stream-client: publish failed: ${String(error)}`)
  }
}

const run = randomUUID()

const entries = makeEntries({
  rig: config.rig,
  source: `${hostname()}:stream-client`,
  run,
  now: () => Date.now(),
})

const build = spawnSync('git', ['-C', import.meta.dirname, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
const version = build.status === 0 ? build.stdout.trim() : 'unknown'
let brokerConnections = 0

function announce() {
  brokerConnections += 1
  publish(
    'rig-dev.client',
    entries.client('connected', {
      client: 'stream-client',
      run,
      connection: brokerConnections,
      version,
      sources: ['wire', 'system', 'phd2'],
      wireDevices: config.wireDevices,
    }),
  )
}

const debugLines = makeDebugChangeFilter()

const tap: TrafficTap = {
  message: ({ conn, dir, xml }) => {
    for (const line of debugLines.pass(xml)) publish(wireSubject(config.wireDevices, dir, line), entries.wire(conn, dir, line))
  },
  connection: connection => {
    debugLines.forget()
    publish('rig-dev.client', entries.client('connection', { target: 'indiserver', conn: connection.conn, status: connection.status, ...(connection.status === 'closed' ? { error: connection.error } : {}) }))
    console.error(`rig-stream-client: indiserver ${connection.status}${connection.status === 'closed' ? `: ${connection.error}` : ''}`)
  },
}

announce()

await Promise.all([
  Effect.runPromise(Effect.scoped(Effect.andThen(makeIndiClient({ ...config.indi, tap }), Effect.never))),
  followJournal(config.journalExclusions, config.journalCursorFile, async line => {
    broker.publish('rig-dev.system', JSON.stringify(entries.system(line)))
    await broker.flush()
  }),
  followPhd2(
    config.phd2,
    line => publish('rig-dev.phd2', entries.phd2(line)),
    status => {
      console.error(`rig-stream-client: phd2 ${JSON.stringify(status)}`)
      publish('rig-dev.client', entries.client('connection', { target: 'phd2', ...status }))
    },
  ),
])
