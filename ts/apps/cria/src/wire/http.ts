/**
 * Wire boundary: protocol 5 over HTTP. Routes decode their input once with the
 * @cria/wire schemas, call the ledger, and project the answer (project.ts). The
 * optional bearer token and the refusal of browser origins live here.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { open } from 'node:fs/promises'
import { pipeline } from 'node:stream'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Effect, Exit, Result, Schema } from 'effect'
import {
  DeviceId,
  ImageId,
  InstanceId,
  OperationId,
  OperationRequest,
  RecoveryRequest,
  RequestId,
  protocolVersion,
  type ErrorBody,
  type ErrorCode,
} from '@cria/wire'
import { Refusal, refuse } from '../refusal.js'
import type { Rig } from '../rig.js'
import { projectDevice, projectState } from './project.js'
import { makeEventStream } from './sse.js'

const maxBodyBytes = 16 * 1024

interface HttpOptions {
  /** When set, every route except /health requires `Authorization: Bearer <token>`. */
  readonly token?: string
}

type Reply = { readonly status: number; readonly body: unknown }

const statusOf: { readonly [C in ErrorCode]: number } = {
  'request-error': 400,
  unauthorized: 401,
  'origin-rejected': 403,
  'commands-disabled': 403,
  'not-found': 404,
  'request-conflict': 409,
  'instance-changed': 409,
  'binding-changed': 409,
  'device-blocked': 409,
  'device-busy': 409,
  'result-expired': 410,
  'image-gone': 410,
  'request-too-large': 413,
  'too-many-subscribers': 429,
  'internal-error': 500,
}

function errorReply(refusal: Refusal, instanceId: InstanceId): { readonly status: number; readonly body: ErrorBody } {
  return { status: statusOf[refusal.code], body: { error: { code: refusal.code, message: refusal.message }, instanceId } }
}

export function makeHttpServer(rig: Rig, options: HttpOptions = {}): Server {
  const events = makeEventStream(rig)
  const tokenDigest = options.token === undefined ? undefined : digest(`Bearer ${options.token}`)

  const run = <A>(effect: Effect.Effect<A, Refusal>, toReply: (value: A) => Reply) =>
    Effect.runPromiseExit(effect).then(exit => {
      if (Exit.isSuccess(exit)) return toReply(exit.value)
      const failure = exit.cause.reasons.find(reason => reason._tag === 'Fail')

      if (failure && failure._tag === 'Fail') throw failure.error
      throw refuse('internal-error', 'Unexpected failure')
    })

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<Reply | 'streamed'> => {
    const url = new URL(request.url ?? '/', 'http://cria')
    const path = url.pathname.split('/').filter(Boolean)
    const method = request.method ?? 'GET'

    if (method === 'GET' && url.pathname === '/health') return { status: 200, body: { status: 'ok', protocolVersion } }

    if (request.headers.origin) throw refuse('origin-rejected', 'Browser origins are not accepted')
    if (tokenDigest && !sameDigest(digest(request.headers.authorization ?? ''), tokenDigest))
      throw refuse('unauthorized', 'Bearer token required')

    if (path[0] !== 'v2') throw refuse('not-found', 'No such route')

    if (method === 'GET' && path.length === 2 && path[1] === 'state')
      return run(Effect.flatMap(rig.ledger.snapshot, snapshot => projectState(rig, snapshot)), state => ({ status: 200, body: state }))

    if (method === 'GET' && path.length === 2 && path[1] === 'events') {
      if (!events(request, response)) throw refuse('too-many-subscribers', 'Too many event subscribers')

      return 'streamed'
    }

    if (method === 'POST' && path.length === 4 && path[1] === 'devices' && path[3] === 'recover') {
      const { instanceId, bindingId, note } = decodeBody(RecoveryRequest, await readJson(request))
      const noDevice = refuse('not-found', `No device ${path[2]}`)
      const deviceId = pathId(DeviceId, path[2], noDevice)
      const device = rig.devices.find(candidate => candidate.config.id === deviceId)

      if (!device) throw noDevice

      return run(
        Effect.flatMap(rig.ledger.recover(deviceId, { instanceId, bindingId, recovery: { confirmed: true, note } }), facts => projectDevice(rig, device, facts)),
        body => ({ status: 200, body }),
      )
    }

    if (method === 'POST' && path.length === 2 && path[1] === 'operations')
      return run(rig.ledger.submit(decodeBody(OperationRequest, await readJson(request))), operation => ({ status: 202, body: operation }))

    if (method === 'GET' && path.length === 3 && path[1] === 'operations')
      return run(rig.ledger.operation(pathId(OperationId, path[2], noOperation())), operation => ({ status: 200, body: operation }))

    if (method === 'POST' && path.length === 4 && path[1] === 'operations' && path[3] === 'cancel')
      return run(rig.ledger.cancel(pathId(OperationId, path[2], noOperation())), operation => ({ status: 202, body: operation }))

    if (method === 'GET' && path.length === 4 && path[1] === 'requests')
      return run(
        rig.ledger.request(pathId(InstanceId, path[2], noRequest()), pathId(RequestId, decodeURIComponent(path[3]!), noRequest())),
        operation => ({ status: 200, body: operation }),
      )

    if (method === 'GET' && path.length === 4 && path[1] === 'images' && path[3] === 'original') {
      await sendImage(rig, pathId(ImageId, path[2], noImage()), response)

      return 'streamed'
    }

    throw refuse('not-found', 'No such route')
  }

  return createServer((request, response) => {
    route(request, response)
      .then(reply => {
        if (reply !== 'streamed') json(response, reply)
      })
      .catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy()

          return
        }

        const refusal = error instanceof Refusal ? error : refuse('internal-error', error instanceof Error ? error.message : String(error))

        json(response, errorReply(refusal, rig.instanceId))
      })
  })
}

async function sendImage(rig: Rig, id: ImageId, response: ServerResponse) {
  const image = await Effect.runPromise(rig.images.find(id))
  // Opening first keeps the file readable even if the store drops it mid-download.
  const handle = image ? await open(image.path, 'r').catch(() => undefined) : undefined

  if (!image || !handle) throw imageGone()

  response.writeHead(200, {
    'content-type': 'application/imagebytes',
    'content-length': String(image.bytes),
    etag: `"${image.sha256}"`,
  })
  // pipeline tears both sides down however the download ends, and the handle is
  // closed explicitly: when Vela hangs up mid-download, a handle left to garbage
  // collection is an uncaught error on Node 26, which would end the process
  // without its finalizers (and without stopping a moving mount). Review R2 P1-A.
  pipeline(handle.createReadStream({ autoClose: false }), response, () => {
    void handle.close().catch(() => undefined)
  })
}

const noOperation = () => refuse('not-found', 'No such operation')
const noRequest = () => refuse('not-found', 'No such request')
const noImage = () => refuse('not-found', 'No such image')
const imageGone = () => refuse('image-gone', 'This image is no longer kept')

function pathId<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, segment: string | undefined, refusal: Refusal): S['Type'] {
  const decoded = Schema.decodeUnknownResult(schema)(segment)

  if (Result.isFailure(decoded)) throw refusal

  return decoded.success
}

/** Validates a request body once, at the boundary; unknown keys are refused. */
function decodeBody<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, body: unknown): S['Type'] {
  const decoded = Schema.decodeUnknownResult(schema)(body, { onExcessProperty: 'error' })

  if (Result.isFailure(decoded)) throw refuse('request-error', decoded.failure.message)

  return decoded.success
}

function json(response: ServerResponse, reply: Reply) {
  const body = JSON.stringify(reply.body)

  response.writeHead(reply.status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > maxBodyBytes) throw refuse('request-too-large', 'Request body too large')
    chunks.push(chunk as Buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw refuse('request-error', 'Body is not JSON')
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function sameDigest(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}
