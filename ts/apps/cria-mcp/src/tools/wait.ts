import { Duration, Effect, Schema } from 'effect'
import type { OperationId } from '@cria/wire'
import { Cria } from '../cria.js'

export const waitCapSeconds = 45

/** Range first: the JSON Schema agents read shows the first check's bounds at the top and `isInt`'s safe-integer bounds under `allOf`. */
export const WaitSeconds = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: waitCapSeconds }), Schema.isInt()))

const pollInterval = Duration.seconds(1)

/**
 * Reads the operation until it settles or `maxSeconds` have passed since entry, a second apart,
 * and returns the last read. The first failed read ends the wait: the answer to that call is the
 * reply, and whether to ask again is the caller's.
 */
export const waitFor = Effect.fnUntraced(function* (operationId: OperationId, maxSeconds: number) {
  const cria = yield* Cria
  const now = Effect.clockWith(clock => clock.currentTimeMillis)
  const deadline = (yield* now) + maxSeconds * 1000

  while (true) {
    const operation = yield* cria.operation(operationId)
    const remaining = deadline - (yield* now)

    if (operation.state === 'settled' || remaining <= 0) return operation
    yield* Effect.sleep(Duration.min(pollInterval, Duration.millis(remaining)))
  }
})
