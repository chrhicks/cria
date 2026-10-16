/**
 * Wire boundary: `GET /v2/events`, a stream of full state snapshots.
 *
 * Not a durable log: snapshots coalesce and a reconnect gets a fresh snapshot.
 * A snapshot goes out at least every second and within 250 ms of an operation
 * or recovery change.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, Fiber, Stream } from 'effect'
import type { Rig } from '../rig.js'
import { projectState } from './project.js'

const maxSubscribers = 16
const tickMs = 250
const steadyMs = 1000
const stuckMs = 30_000

export function makeEventStream(rig: Rig) {
  let subscribers = 0

  return (request: IncomingMessage, response: ServerResponse): boolean => {
    if (subscribers >= maxSubscribers) return false
    subscribers += 1

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    let lastSentAt = 0
    let revision = 0
    let sentRevision = -1
    let sending = false

    const following = Effect.runFork(Stream.runForEach(rig.ledger.revisions, latest => Effect.sync(() => void (revision = latest))))

    const send = async () => {
      if (sending) return
      sending = true
      try {
        const { state, snapshotRevision } = await Effect.runPromise(
          Effect.flatMap(rig.ledger.snapshot, snapshot => Effect.map(projectState(rig, snapshot), state => ({ state, snapshotRevision: snapshot.revision }))),
        )

        sentRevision = snapshotRevision
        lastSentAt = Date.now()
        response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
      } catch {
        // A snapshot that can't be built ends this stream; Vela reconnects and gets a fresh one.
        response.destroy()
      } finally {
        sending = false
      }
    }

    let congestedSince: number | undefined

    const timer = setInterval(() => {
      const now = Date.now()

      // A slow subscriber gets no new writes until its socket drains; the next
      // snapshot it gets is the latest, so nothing is lost but intermediate
      // states (snapshots coalesce anyway). Stuck too long: disconnect it, and
      // a reconnect starts from a fresh snapshot (review R1-#13).
      if (response.writableNeedDrain) {
        congestedSince ??= now
        if (now - congestedSince >= stuckMs) response.destroy()

        return
      }

      congestedSince = undefined

      if (revision > sentRevision || now - lastSentAt >= steadyMs) void send()
    }, tickMs)

    const close = () => {
      clearInterval(timer)
      Effect.runFork(Fiber.interrupt(following))
      subscribers -= 1
    }

    request.once('close', close)
    void send()

    return true
  }
}
