/**
 * Test support: a small typed Cria client built from @cria/wire. Every
 * response is decoded strictly against the protocol 5 schemas, so any test
 * that goes through it also checks the contract. It does what Vela's client
 * does on the wire (state, events, admit, follow, cancel, download) and
 * nothing more: no retries, no freshness arithmetic.
 */
import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import { ErrorBody, Health, Operation, State, type OperationRequest } from '@cria/wire'

const strict = { onExcessProperty: 'error' } as const

export type Reply<T> = { readonly status: number; readonly ok: true; readonly body: T } | { readonly status: number; readonly ok: false; readonly body: typeof ErrorBody.Type }

export class CriaContractError extends Error {
  override readonly name = 'CriaContractError'
}

function decode<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown, what: string): S['Type'] {
  try {
    return Schema.decodeUnknownSync(schema)(value, strict)
  } catch (error) {
    throw new CriaContractError(`${what} broke the protocol 5 contract: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function makeCriaClient(base: string, fetch: typeof globalThis.fetch = globalThis.fetch) {
  async function request<S extends Schema.Top & { readonly DecodingServices: never }>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<Reply<S['Type']>> {
    const response = await fetch(base + path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })
    const json: unknown = await response.json()

    if (!response.ok) return { status: response.status, ok: false, body: decode(ErrorBody, json, `${method} ${path} error`) }

    return { status: response.status, ok: true, body: decode(schema, json, `${method} ${path}`) }
  }

  const ok = async <T>(reply: Promise<Reply<T>>): Promise<T> => {
    const settled = await reply

    if (!settled.ok) throw new Error(`Cria refused: ${settled.status} ${settled.body.error.code}: ${settled.body.error.message}`)

    return settled.body
  }

  return {
    health: () => ok(request('GET', '/health', Health)),
    state: () => ok(request('GET', '/v2/state', State)),
    submit: (body: OperationRequest) => request('POST', '/v2/operations', Operation, body),
    operation: (id: string) => request('GET', `/v2/operations/${id}`, Operation),
    byRequest: (instanceId: string, requestId: string) => request('GET', `/v2/requests/${instanceId}/${encodeURIComponent(requestId)}`, Operation),
    cancel: (id: string) => request('POST', `/v2/operations/${id}/cancel`, Operation),
    recover: (deviceId: string, body: unknown) => request('POST', `/v2/devices/${deviceId}/recover`, Schema.Unknown, body),

    /** The first SSE `state` event, decoded. */
    async firstEvent(): Promise<State> {
      const response = await fetch(`${base}/v2/events`, { headers: { accept: 'text/event-stream' } })
      const reader = response.body!.getReader()
      let text = ''

      try {
        while (true) {
          const { value, done } = await reader.read()

          if (done) throw new Error('event stream ended')
          text += new TextDecoder().decode(value)
          const event = /event: state\ndata: (.*)\n\n/.exec(text)

          if (event) return decode(State, JSON.parse(event[1]!), 'SSE state')
        }
      } finally {
        await reader.cancel()
      }
    },

    /** Asks for an original by raw id and returns the refusal; the id need not be well formed. */
    async refusedOriginal(id: string) {
      const response = await fetch(`${base}/v2/images/${id}/original`)

      return { status: response.status, body: decode(ErrorBody, await response.json(), `GET /v2/images/${id}/original error`) }
    },

    /** Downloads a confirmed capture's original and checks it against the image record. */
    async download(operation: Operation) {
      if (operation.state !== 'settled' || operation.outcome.kind !== 'confirmed' || !operation.outcome.value.image) throw new Error('No image on this operation')
      const image = operation.outcome.value.image
      const response = await fetch(base + image.original.url)

      if (response.status !== 200) return { status: response.status } as const
      const bytes = Buffer.from(await response.arrayBuffer())

      if (response.headers.get('content-type') !== 'application/imagebytes') throw new CriaContractError('original is not ImageBytes')
      if (bytes.length !== image.original.bytes || Number(response.headers.get('content-length')) !== bytes.length)
        throw new CriaContractError('original length differs from its record')
      if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new CriaContractError('original digest differs')
      if (bytes.readInt32LE(32) !== image.width || bytes.readInt32LE(36) !== image.height) throw new CriaContractError('ImageBytes geometry differs')

      return { status: 200, bytes } as const
    },
  }
}

export type CriaClient = ReturnType<typeof makeCriaClient>
