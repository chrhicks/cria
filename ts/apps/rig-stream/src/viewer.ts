#!/usr/bin/env node
/**
 * Dev stream viewer: a small web server on thuban that creates the dev stream
 * if it is missing and sends its messages to each open page as server-sent
 * events. Read-only apart from creating that stream.
 */
import { readFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { DeliverPolicy, jetstream, jetstreamManager, RetentionPolicy, StorageType } from '@nats-io/jetstream'
import { connect, nanos } from '@nats-io/transport-node'
import { Schema } from 'effect'
import { Broker, loadConfig } from './config.js'

const stream = 'RIG_DEV'
/** What a new page shows at once: enough to fill a screen before live messages arrive. */
const backlog = 200
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
  // Throwaway data: long enough to look back across a few iterations, at about 125 MB a day.
  max_age: nanos(7 * 24 * 3600 * 1000),
})

async function follow(response: ServerResponse, lastSeen: number | undefined) {
  const { state } = await manager.streams.info(stream)
  const start = lastSeen === undefined ? Math.max(1, state.last_seq - backlog + 1) : lastSeen + 1
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

    // The browser sends the last id it saw when it reconnects, so a reconnect continues without repeats.
    const lastEventId = Number(request.headers['last-event-id'])

    follow(response, Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : undefined)
      .catch((error: unknown) => console.error(`rig-stream-viewer: ${String(error)}`))
      .finally(() => response.end())

    return
  }

  response.writeHead(404).end()
}).listen(config.port, '127.0.0.1', () => console.error(`rig-stream-viewer: http://127.0.0.1:${config.port}/`))
