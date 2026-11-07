import { randomUUID } from 'node:crypto'
import { InstanceId } from '@cria/wire'

export const mintInstanceId = () => InstanceId.make(randomUUID())
