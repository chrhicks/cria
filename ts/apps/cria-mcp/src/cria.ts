import { Context, Data, Duration, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { ErrorBody, State } from '@cria/wire'

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

export class Cria extends Context.Service<Cria, {
  /** GET /v2/state */
  readonly state: Effect.Effect<State, CriaError>
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

  const exchange = <S extends Schema.Top & { readonly DecodingServices: never }>(
    method: 'GET',
    path: string,
    schema: S,
  ): Effect.Effect<S['Type'], CriaError> => {
    const route = `${method} ${path}`
    const lost = (why: (typeof lostReasons)[number], message: string) => new CriaLost({ route, why, message })
    const request = withToken(HttpClientRequest.get(new URL(path, target.origin).href).pipe(HttpClientRequest.acceptJson))

    return Effect.gen(function* () {
      const response = yield* http.execute(request).pipe(Effect.mapError(error => lost('transport', error.message)))
      const json = yield* response.json.pipe(Effect.mapError(() => lost('not-protocol-5', `HTTP ${response.status} with a body that is not JSON`)))

      if (response.status >= 200 && response.status < 300)
        return yield* Schema.decodeUnknownEffect(schema)(json, strict).pipe(
          Effect.mapError(error => lost('not-protocol-5', error.message)),
        )

      const body = yield* Schema.decodeUnknownEffect(ErrorBody)(json, strict).pipe(
        Effect.mapError(() => lost('not-protocol-5', `HTTP ${response.status} without a protocol 5 error body`)),
      )

      return yield* Effect.fail(new CriaRefused({ status: response.status, body }))
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: target.replyTimeout,
        orElse: () => Effect.fail(lost('timeout', `no complete reply within ${Duration.format(Duration.fromInputUnsafe(target.replyTimeout))}`)),
      }),
    )
  }

  return Cria.of({ state: exchange('GET', '/v2/state', State) })
})
