#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { DeliverPolicy, jetstream, jetstreamManager, RetentionPolicy, StorageType } from '@nats-io/jetstream'
import { connect, nanos } from '@nats-io/transport-node'
import { Effect } from 'effect'
import { ViewerConfig } from './config.js'
import { makeHistory, parseQuery, type HistoryQuery } from './viewer-history.js'

const stream = 'RIG_DEV'
const page = readFileSync(new URL('../src/viewer.html', import.meta.url))

const config = await Effect.runPromise(Effect.provide(Effect.service(ViewerConfig), ViewerConfig.layer))
const broker = await connect({ ...config.broker, name: 'rig-stream-viewer', maxReconnectAttempts: -1 })
const manager = await jetstreamManager(broker)
const client = jetstream(broker)

await manager.streams.add({
  name: stream,
  subjects: ['rig-dev.>'],
  storage: StorageType.File,
  retention: RetentionPolicy.Limits,
  max_age: nanos(config.streamMaxAgeDays * 24 * 3600 * 1000),
})

const progressEvery = 100000

function send(response: ServerResponse, event: string, data: unknown, id?: number) {
  response.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function startOf(query: HistoryQuery, lastSeen: number | undefined, lastSeq: number) {
  if (lastSeen !== undefined) return { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: lastSeen + 1 }
  if (query.since !== undefined) return { deliver_policy: DeliverPolicy.StartTime, opt_start_time: new Date(query.since).toISOString() }

  return { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: Math.max(1, lastSeq - config.rowsKeptOnPage + 1) }
}

async function follow(response: ServerResponse, query: HistoryQuery, lastSeen: number | undefined) {
  const { state } = await manager.streams.info(stream)
  const consumer = await client.consumers.get(stream, startOf(query, lastSeen, state.last_seq))
  const messages = await consumer.consume({ max_messages: config.historyReadBatch })
  const history = makeHistory(query, config.rowsKeptOnPage)
  let reading = lastSeen === undefined
  let lastRead = lastSeen ?? 0
  let read = 0
  let lastCounted = 0

  const finishReading = () => {
    reading = false
    send(response, 'history', { entries: history.drained(), groups: query.table ? history.groups() : [], ...history.counted() }, lastRead)
  }

  const finishRange = () => {
    if (reading) finishReading()
    send(response, 'end', {})
    void messages.stop()
  }

  response.on('close', () => void messages.stop())

  if (reading && (await consumer.info()).num_pending === 0) {
    if (query.until === undefined) finishReading()
    else finishRange()
  }

  for await (const message of messages) {
    const at = message.time.getTime()

    if (query.until !== undefined && at > query.until) {
      finishRange()
      break
    }

    const delivered = history.take({ seq: message.seq, at, subject: message.subject, text: message.string() })

    lastRead = message.seq
    read += 1

    if (reading) {
      if (read % progressEvery === 0) send(response, 'progress', { read })
      if (message.info.pending === 0) {
        if (query.until === undefined) finishReading()
        else {
          finishRange()
          break
        }
      }
    } else {
      if (delivered !== undefined) send(response, 'message', delivered, message.seq)
      if (at - lastCounted >= 1000) {
        lastCounted = at
        send(response, 'counts', history.counted())
      }
      history.drained()
    }
  }
}

createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)

    return
  }

  if (request.url === '/settings') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ rowsKeptOnPage: config.rowsKeptOnPage }))

    return
  }

  const url = new URL(request.url ?? '/', 'http://viewer')

  if (url.pathname === '/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    response.flushHeaders()

    const lastSeenByBrowser = Number(request.headers['last-event-id'])

    follow(response, parseQuery(url.searchParams), Number.isSafeInteger(lastSeenByBrowser) && lastSeenByBrowser > 0 ? lastSeenByBrowser : undefined)
      .catch((error: unknown) => console.error(`rig-stream-viewer: ${String(error)}`))
      .finally(() => response.end())

    return
  }

  response.writeHead(404).end()
}).listen(config.port, '127.0.0.1', () => console.error(`rig-stream-viewer: http://127.0.0.1:${config.port}/`))
