#!/usr/bin/env node
import { makeIndiClient, type TrafficTap } from '@cria/indi'
import { connect } from '@nats-io/transport-node'
import { Effect } from 'effect'
import { ClientConfig } from './config.js'

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

const tap: TrafficTap = {
  message: ({ dir, xml }) => {
    try {
      broker.publish(`rig-dev.wire.${dir}`, xml)
    } catch (error) {
      console.error(`rig-stream-client: publish failed: ${String(error)}`)
    }
  },
  connection: connection => console.error(`rig-stream-client: indiserver ${connection.status}${connection.status === 'closed' ? `: ${connection.error}` : ''}`),
}

await Effect.runPromise(Effect.scoped(Effect.andThen(makeIndiClient({ ...config.indi, tap }), Effect.never)))
