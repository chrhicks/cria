/**
 * Composition: the service process. Builds the rig in one scope and serves it
 * over HTTP; closing the scope stops the HTTP server and interrupts every
 * Run, whose stoppable disciplines then stop moving equipment.
 */
import type { AddressInfo } from 'node:net'
import { Effect, Exit, Scope } from 'effect'
import type { Config } from './config.js'
import { makeRig, type Rig } from './rig.js'
import { makeHttpServer } from './wire/http.js'

export interface RunningService {
  readonly rig: Rig
  readonly port: number
  readonly stop: () => Promise<void>
}

export async function startService(config: Config, options: { readonly token?: string } = {}): Promise<RunningService> {
  const scope = Effect.runSync(Scope.make())

  const program = Effect.gen(function* () {
    const rig = yield* makeRig(config)
    const server = makeHttpServer(rig, options)

    yield* Effect.acquireRelease(
      Effect.callback<void, Error>(resume => {
        server.once('error', error => resume(Effect.fail(error)))
        server.listen(config.listen.port, config.listen.host, () => resume(Effect.void))
      }),
      () =>
        Effect.callback<void>(resume => {
          server.closeAllConnections()
          server.close(() => resume(Effect.void))
        }),
    )

    return { rig, port: (server.address() as AddressInfo).port }
  })

  const started = await Effect.runPromiseExit(Scope.provide(program, scope))

  if (Exit.isFailure(started)) {
    await Effect.runPromise(Scope.close(scope, started))
    throw new Error(`Cria did not start: ${String(started.cause)}`)
  }

  return {
    ...started.value,
    stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
