#!/usr/bin/env node
/**
 * Stream client, first iteration: connects to indiserver and publishes each
 * message, as the raw text the wire carried, to the dev stream. It never asks
 * for frames, so it gets none.
 *
 * Not here yet, on purpose: a spool, an entry format, typed messages. While
 * the broker is away, the NATS client holds what it can and anything beyond
 * that is lost.
 */
import { makeIndiClient, type TrafficTap } from '@cria/indi'
import { connect } from '@nats-io/transport-node'
import { Effect, Schema } from 'effect'
import { Broker, loadConfig } from './config.js'

const config = loadConfig(
  'rig-stream-client',
  Schema.Struct({
    indi: Schema.Struct({ host: Schema.String, port: Schema.Number }),
    broker: Broker,
  }),
)

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
  // The tap must never throw (see TrafficTap): a message over the broker's size limit is logged and skipped.
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
