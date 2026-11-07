import { randomUUID } from 'node:crypto'
import { ImageId, InstanceId, OperationId, RequestId } from '@cria/wire'

export const mint = {
  instanceId: () => InstanceId.make(randomUUID()),
  operationId: () => OperationId.make(randomUUID()),
  imageId: () => ImageId.make(randomUUID()),
  startupRequestId: () => RequestId.make(`startup-${randomUUID()}`),
}
