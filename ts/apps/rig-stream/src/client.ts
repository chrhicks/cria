#!/usr/bin/env node
import { makeIndiClient, type TrafficTap } from '@cria/indi'
import { connect } from '@nats-io/transport-node'
import { Effect } from 'effect'
import { ClientConfig } from './config.js'
import { makeDebugChangeFilter } from './debug-lines.js'
import { followJournal } from './journal.js'

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

function publish(subject: string, text: string) {
  try {
    broker.publish(subject, text)
  } catch (error) {
    console.error(`rig-stream-client: publish failed: ${String(error)}`)
  }
}

const debugLines = makeDebugChangeFilter()

const tap: TrafficTap = {
  message: ({ dir, xml }) => {
    for (const line of debugLines.pass(xml)) publish(`rig-dev.wire.${dir}`, line)
  },
  connection: connection => {
    debugLines.forget()
    console.error(`rig-stream-client: indiserver ${connection.status}${connection.status === 'closed' ? `: ${connection.error}` : ''}`)
  },
}

await Promise.all([
  Effect.runPromise(Effect.scoped(Effect.andThen(makeIndiClient({ ...config.indi, tap }), Effect.never))),
  followJournal(config.journalExclusions, line => publish('rig-dev.system', line)),
])
