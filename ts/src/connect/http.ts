import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Effect, Result, Schema } from 'effect'
import { ConnectRequest, protocolVersion } from './wire.ts'
import type { Rig } from './rig.ts'

interface Reply {
  readonly status: number
  readonly body: unknown
}

const decodeConnect = Schema.decodeUnknownResult(Schema.fromJsonString(ConnectRequest))

const readBody = (request: IncomingMessage) =>
  Effect.promise(async () => {
    const chunks: Buffer[] = []

    for await (const chunk of request) chunks.push(chunk as Buffer)

    return Buffer.concat(chunks).toString('utf8')
  })

export function makeHttpServer(rig: Rig): Server {
  const handle = (request: IncomingMessage): Effect.Effect<Reply> =>
    Effect.gen(function* () {
      const path = new URL(request.url ?? '/', 'http://cria').pathname

      if (request.method === 'GET' && path === '/health') return { status: 200, body: { status: 'ok', protocolVersion, instanceId: rig.instanceId } }

      if (request.method !== 'POST' || path !== '/connect') return { status: 404, body: { message: 'No such route' } }

      const decoded = decodeConnect(yield* readBody(request), { onExcessProperty: 'error' })

      if (Result.isFailure(decoded)) return { status: 400, body: { message: decoded.failure.message } }

      const result = yield* rig.connect(decoded.success)

      return result ? { status: 200, body: result } : { status: 404, body: { message: `No device ${decoded.success.deviceId}` } }
    })

  return createServer((request, response) => {
    void Effect.runPromise(handle(request)).then(reply => {
      const body = JSON.stringify(reply.body)

      response.writeHead(reply.status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
      response.end(body)
    }, () => response.destroy())
  })
}
