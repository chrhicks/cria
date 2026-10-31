import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import { DeviceId, Image as WireImage, InstanceId, OperationId, RecoveryRequest, RequestId } from '@cria/wire'
import { Cria } from '../cria.js'
import { routes } from '../exposure.js'
import { ImageCache } from '../image-cache.js'
import { Reply, toReply } from '../reply.js'
import { change, read } from './annotations.js'
import { WaitSeconds, waitCapSeconds, waitFor } from './wait.js'

export const State = read(Tool.make('state', { description: routes.state.description, success: Reply }))

export const Operation = read(
  Tool.make('operation', { description: routes.operation.description, parameters: Schema.Struct({ operationId: OperationId }), success: Reply }),
)

export const Wait = read(
  Tool.make('wait', {
    description: routes.wait.description,
    parameters: Schema.Struct({ operationId: OperationId, maxSeconds: Schema.optionalKey(WaitSeconds) }),
    success: Reply,
  }),
)

export const Request = read(
  Tool.make('request', { description: routes.request.description, parameters: Schema.Struct({ instanceId: InstanceId, requestId: RequestId }), success: Reply }),
)

export const Image = read(Tool.make('image', { description: routes.image.description, parameters: Schema.Struct({ image: WireImage }), success: Reply }))

export const Cancel = change(
  Tool.make('cancel', { description: routes.cancel.description, parameters: Schema.Struct({ operationId: OperationId }), success: Reply }),
  false,
)

export const Recover = change(
  Tool.make('recover', {
    description: routes.recover.description,
    parameters: Schema.Struct({ deviceId: DeviceId, ...RecoveryRequest.fields }),
    success: Reply,
  }),
  true,
)

export const RouteToolkit = Toolkit.make(State, Operation, Wait, Request, Image, Cancel, Recover)

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
      cancel: ({ operationId }) => toReply(cria.cancel(operationId)),
      recover: ({ deviceId, ...request }) => toReply(cria.recover(deviceId, request)),
    })
  }),
)
