import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import { Cria } from '../cria.js'
import { Reply, toReply } from '../reply.js'

export const State = Tool.make('state', {
  description:
    "Cria's current state: its instanceId, every device with its id, bindingId, name, availability and readings, the holds, the operations in flight and whether commands are enabled. Read it before any command and copy the identity fields from it.",
  success: Reply,
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const RouteToolkit = Toolkit.make(State)

export const RouteHandlers = RouteToolkit.toLayer(
  Effect.gen(function* () {
    const cria = yield* Cria

    return RouteToolkit.of({ state: () => toReply(cria.state) })
  }),
)
