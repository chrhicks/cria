import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import { Image as WireImage, InstanceId, OperationId, RequestId } from '@cria/wire'
import { Cria } from '../cria.js'
import { ImageCache } from '../image-cache.js'
import { Reply, toReply } from '../reply.js'
import { WaitSeconds, waitCapSeconds, waitFor } from './wait.js'

/** Strict, and a read of Cria or of this host's image directory: no call changes the rig. */
type ToolConfig = {
  readonly parameters: Schema.Constraint
  readonly success: Schema.Constraint
  readonly failure: Schema.Constraint
  readonly failureMode: Tool.FailureMode
}

const read = <N extends string, C extends ToolConfig, R>(tool: Tool.Tool<N, C, R>): Tool.Tool<N, C, R> =>
  tool.annotate(Tool.Strict, true).annotate(Tool.Readonly, true).annotate(Tool.Destructive, false).annotate(Tool.Idempotent, true).annotate(Tool.OpenWorld, false)

export const State = read(
  Tool.make('state', {
    description:
      "Cria's current state: its instanceId, every device with its id, bindingId, name, availability and readings, the holds, the operations in flight and whether commands are enabled. Read it before any command and copy the identity fields from it.",
    success: Reply,
  }),
)

export const Operation = read(
  Tool.make('operation', {
    description: 'One operation by id: waiting, running with its progress, or settled with its outcome (confirmed, failed, stopped or uncertain) exactly as Cria reports it.',
    parameters: Schema.Struct({ operationId: OperationId }),
    success: Reply,
  }),
)

export const Wait = read(
  Tool.make('wait', {
    description: `Reads an operation once a second until it settles or maxSeconds (1 to ${waitCapSeconds}, default ${waitCapSeconds}) have passed, and returns the last read. An operation still running at the deadline is a normal answer: call wait again in your next call. A failed read ends the wait with that failure.`,
    parameters: Schema.Struct({ operationId: OperationId, maxSeconds: Schema.optionalKey(WaitSeconds) }),
    success: Reply,
  }),
)

export const Request = read(
  Tool.make('request', {
    description:
      'The operation a requestId created, for when the answer to a command was lost. Refused as not-found means Cria never admitted that request. Do not send the command again before this answers.',
    parameters: Schema.Struct({ instanceId: InstanceId, requestId: RequestId }),
    success: Reply,
  }),
)

export const Image = read(
  Tool.make('image', {
    description:
      "Downloads a captured frame to a file on this host and returns the Image, the file's absolute path, its sha256 and its size. Pass the image from a confirmed capture outcome unchanged. The file is Cria's raw imagebytes, checked against the image's sha256, and is deleted after seven days.",
    parameters: Schema.Struct({ image: WireImage }),
    success: Reply,
  }),
)

export const RouteToolkit = Toolkit.make(State, Operation, Wait, Request, Image)

export const RouteHandlers = RouteToolkit.toLayer(
  Effect.gen(function* () {
    const cria = yield* Cria
    const images = yield* ImageCache
    const context = yield* Effect.context<Cria>()

    return RouteToolkit.of({
      state: () => toReply(cria.state),
      operation: ({ operationId }) => toReply(cria.operation(operationId)),
      wait: ({ operationId, maxSeconds }) => toReply(waitFor(operationId, maxSeconds ?? waitCapSeconds).pipe(Effect.provideContext(context))),
      request: ({ instanceId, requestId }) => toReply(cria.request(instanceId, requestId)),
      image: ({ image }) => toReply(images.fetch(image)),
    })
  }),
)
