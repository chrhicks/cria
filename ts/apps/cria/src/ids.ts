import { randomUUID } from 'node:crypto'
import { BindingId, ImageId, InstanceId, OperationId, RequestId } from '@cria/wire'

export const mint = {
  instanceId: () => InstanceId.make(randomUUID()),
  operationId: () => OperationId.make(randomUUID()),
  imageId: () => ImageId.make(randomUUID()),
  bindingId: () => BindingId.make(randomUUID()),
  startupRequestId: () => RequestId.make(`startup-${randomUUID()}`),
}
