import { randomUUID } from 'node:crypto'
import { Effect, Scope } from 'effect'
import { makeIndiClient, type IndiClient } from '../indi/index.ts'
import { InstanceId, type ConnectRequest, type ConnectResult } from './wire.ts'
import type { Config } from './config.ts'
import { connectDevice } from './connect.ts'
import { makeCriaStream, type OpenPublisher } from './stream.ts'

export interface Rig {
  readonly instanceId: InstanceId
  readonly client: IndiClient
  readonly connect: (request: ConnectRequest) => Effect.Effect<ConnectResult | undefined>
}

export function makeRig(config: Config, options: { readonly stream?: OpenPublisher } = {}): Effect.Effect<Rig, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const instanceId = InstanceId.make(randomUUID())
    const stream = yield* makeCriaStream(config, instanceId, options.stream)
    const client = yield* makeIndiClient({ ...config.indi, ...(stream ? { tap: stream.traffic } : {}) })

    const connect = (request: ConnectRequest) =>
      Effect.gen(function* () {
        const device = config.devices.find(candidate => candidate.id === request.deviceId)

        if (!device) return undefined

        stream?.request(request)

        const result = yield* connectDevice(client.device(device.indiDevice), device, request.connected, config)

        stream?.settled(request, result)

        return result
      })

    return { instanceId, client, connect }
  })
}
