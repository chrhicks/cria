import { Context, Data, Duration, Effect, Layer, Option, Redacted, Schema, Stream, type Scope } from 'effect'
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http'
import { ErrorBody, Operation, State, type ImageId, type InstanceId, type OperationId, type RequestId } from '@cria/wire'

const strict = { onExcessProperty: 'error' } as const

export class CriaRefused extends Data.TaggedError('CriaRefused')<{
  readonly status: number
  readonly body: ErrorBody
}> {}

export const lostReasons = ['timeout', 'transport', 'not-protocol-5'] as const

export class CriaLost extends Data.TaggedError('CriaLost')<{
  readonly route: string
  readonly why: (typeof lostReasons)[number]
  readonly message: string
}> {}

export type CriaError = CriaRefused | CriaLost

export interface CriaTarget {
  readonly origin: URL
  readonly token: Option.Option<Redacted.Redacted<string>>
  readonly replyTimeout: Duration.Input
}

/** The head of an image download and its body, still unread. The caller's scope keeps the connection open. */
export interface Original {
  readonly contentLength: Option.Option<number>
  readonly etag: Option.Option<string>
  readonly body: Stream.Stream<Uint8Array, CriaLost>
}

export class Cria extends Context.Service<Cria, {
  /** GET /v2/state */
  readonly state: Effect.Effect<State, CriaError>
  /** GET /v2/operations/{id} */
  readonly operation: (id: OperationId) => Effect.Effect<Operation, CriaError>
  /** GET /v2/requests/{instanceId}/{requestId} */
  readonly request: (instanceId: InstanceId, requestId: RequestId) => Effect.Effect<Operation, CriaError>
  /**
   * GET /v2/images/{id}/original. `replyTimeout` bounds the wait for the head only;
   * how long the body may take is the caller's to bound.
   */
  readonly original: (id: ImageId) => Effect.Effect<Original, CriaError, Scope.Scope>
}>()('@cria/mcp/Cria') {
  static readonly layer = (target: CriaTarget): Layer.Layer<Cria, never, HttpClient.HttpClient> =>
    Layer.effect(Cria)(make(target))
}

const make = Effect.fnUntraced(function* (target: CriaTarget) {
  const http = yield* HttpClient.HttpClient
  const withToken = Option.match(target.token, {
    onNone: () => (request: HttpClientRequest.HttpClientRequest) => request,
    onSome: token => HttpClientRequest.bearerToken(Redacted.value(token)),
  })

  const get = (path: string) => withToken(HttpClientRequest.get(new URL(path, target.origin).href))
  const lostAt = (route: string) => (why: (typeof lostReasons)[number], message: string) => new CriaLost({ route, why, message })

  const refusal = (response: HttpClientResponse.HttpClientResponse, lost: ReturnType<typeof lostAt>) =>
    Effect.gen(function* () {
      const json = yield* response.json.pipe(Effect.mapError(() => lost('not-protocol-5', `HTTP ${response.status} with a body that is not JSON`)))
      const body = yield* Schema.decodeUnknownEffect(ErrorBody)(json, strict).pipe(
        Effect.mapError(() => lost('not-protocol-5', `HTTP ${response.status} without a protocol 5 error body`)),
      )

      return yield* Effect.fail(new CriaRefused({ status: response.status, body }))
    })

  const timeLimit = (lost: ReturnType<typeof lostAt>) =>
    Effect.timeoutOrElse({
      duration: target.replyTimeout,
      orElse: () => Effect.fail(lost('timeout', `no complete reply within ${Duration.format(Duration.fromInputUnsafe(target.replyTimeout))}`)),
    })

  const succeeded = (response: HttpClientResponse.HttpClientResponse) => response.status >= 200 && response.status < 300

  const exchange = <S extends Schema.Top & { readonly DecodingServices: never }>(path: string, schema: S): Effect.Effect<S['Type'], CriaError> => {
    const lost = lostAt(`GET ${path}`)
    const request = get(path).pipe(HttpClientRequest.acceptJson)

    return Effect.gen(function* () {
      const response = yield* http.execute(request).pipe(Effect.mapError(error => lost('transport', `no response from Cria (${error.reason._tag})`)))

      if (!succeeded(response)) return yield* refusal(response, lost)

      const json = yield* response.json.pipe(Effect.mapError(() => lost('not-protocol-5', `HTTP ${response.status} with a body that is not JSON`)))

      return yield* Schema.decodeUnknownEffect(schema)(json, strict).pipe(Effect.mapError(error => lost('not-protocol-5', error.message)))
    }).pipe(Effect.scoped, timeLimit(lost))
  }

  const original = (id: ImageId): Effect.Effect<Original, CriaError, Scope.Scope> => {
    const path = `/v2/images/${id}/original`
    const lost = lostAt(`GET ${path}`)
    const request = get(path)

    return Effect.gen(function* () {
      const response = yield* http.execute(request).pipe(Effect.mapError(error => lost('transport', `no response from Cria (${error.reason._tag})`)))

      if (!succeeded(response)) return yield* refusal(response, lost)

      const mediaType = response.headers['content-type']

      if (mediaType !== 'application/imagebytes') return yield* Effect.fail(lost('not-protocol-5', `HTTP ${response.status} with a body that is not imagebytes`))

      const contentLength = Option.filter(Option.map(Option.fromUndefinedOr(response.headers['content-length']), Number), Number.isSafeInteger)

      return {
        contentLength,
        etag: Option.fromUndefinedOr(response.headers.etag),
        body: response.stream.pipe(Stream.mapError(() => lost('transport', 'the connection ended before the image body was complete'))),
      }
    }).pipe(timeLimit(lost))
  }

  return Cria.of({
    state: exchange('/v2/state', State),
    operation: id => exchange(`/v2/operations/${id}`, Operation),
    request: (instanceId, requestId) => exchange(`/v2/requests/${instanceId}/${encodeURIComponent(requestId)}`, Operation),
    original,
  })
})
