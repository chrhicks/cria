import { Effect, Scope } from 'effect'
import { makeIndiClient, type IndiClient } from '@cria/indi'
import type { ConnectRequest, ConnectResult, InstanceId } from '@cria/wire'
import type { Config } from './config.js'
import { connectDevice } from './connect.js'
import { mintInstanceId } from './ids.js'
import { makeCriaStream, type OpenPublisher } from './stream.js'

export interface Rig {
  readonly instanceId: InstanceId
  readonly client: IndiClient
  readonly connect: (request: ConnectRequest) => Effect.Effect<ConnectResult | undefined>
}

export function makeRig(config: Config, options: { readonly stream?: OpenPublisher } = {}): Effect.Effect<Rig, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const instanceId = mintInstanceId()
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
