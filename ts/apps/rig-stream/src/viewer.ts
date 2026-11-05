#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { DeliverPolicy, jetstream, jetstreamManager, RetentionPolicy, StorageType } from '@nats-io/jetstream'
import { connect, nanos } from '@nats-io/transport-node'
import { Schema } from 'effect'
import { Broker, loadConfig } from './config.js'

const stream = 'RIG_DEV'
const messagesShownOnOpen = 200
const throwawayDataMaxAge = nanos(7 * 24 * 3600 * 1000)
const page = readFileSync(new URL('../src/viewer.html', import.meta.url))

const config = loadConfig('rig-stream-viewer', Schema.Struct({ port: Schema.Number, broker: Broker }))
const broker = await connect({ ...config.broker, name: 'rig-stream-viewer', maxReconnectAttempts: -1 })
const manager = await jetstreamManager(broker)
const client = jetstream(broker)

await manager.streams.add({
  name: stream,
  subjects: ['rig-dev.>'],
  storage: StorageType.File,
  retention: RetentionPolicy.Limits,
  max_age: throwawayDataMaxAge,
})

async function follow(response: ServerResponse, lastSeen: number | undefined) {
  const { state } = await manager.streams.info(stream)
  const start = lastSeen === undefined ? Math.max(1, state.last_seq - messagesShownOnOpen + 1) : lastSeen + 1
  const consumer = await client.consumers.get(stream, { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: start })
  const messages = await consumer.consume()

  response.on('close', () => void messages.stop())

  for await (const message of messages) {
    const entry = { seq: message.seq, at: message.time.getTime(), subject: message.subject, xml: message.string() }

    response.write(`id: ${message.seq}\ndata: ${JSON.stringify(entry)}\n\n`)
  }
}

createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)

    return
  }

  if (request.url === '/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    response.flushHeaders()

    const lastSeenByBrowser = Number(request.headers['last-event-id'])

    follow(response, Number.isSafeInteger(lastSeenByBrowser) && lastSeenByBrowser > 0 ? lastSeenByBrowser : undefined)
      .catch((error: unknown) => console.error(`rig-stream-viewer: ${String(error)}`))
      .finally(() => response.end())

    return
  }

  response.writeHead(404).end()
}).listen(config.port, '127.0.0.1', () => console.error(`rig-stream-viewer: http://127.0.0.1:${config.port}/`))
