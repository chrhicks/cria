import { Effect, Option } from 'effect'
import type { ConnectResult } from '@cria/wire'
import { decodeConfig } from '../src/config.js'
import { startService, type RunningService } from '../src/service.js'
import type { OpenPublisher } from '../src/stream.js'

export interface DeviceSpec {
  readonly id: string
  readonly kind: 'camera' | 'mount' | 'focuser' | 'box'
  readonly indiDevice: string
  readonly port?: string
  readonly site?: { readonly latitudeDegrees: number; readonly longitudeDegrees: number; readonly elevationMeters: number }
  readonly driverDebug?: boolean
}

export interface Reply<T = unknown> {
  readonly status: number
  readonly body: T
}

export interface Cria {
  readonly service: RunningService
  readonly base: string
  readonly get: (path: string) => Promise<Reply>
  readonly post: (path: string, body: string | object) => Promise<Reply>
  readonly connect: (deviceId: string, connected?: boolean) => Promise<ConnectResult>
  readonly stop: () => Promise<void>
}

export async function startCria(indiPort: number, devices: ReadonlyArray<DeviceSpec>, overrides: object = {}, options: { readonly stream?: OpenPublisher } = {}): Promise<Cria> {
  const config = decodeConfig({
    listen: { host: '127.0.0.1', port: 0 },
    indi: { host: '127.0.0.1', port: indiPort },
    devices,
    ...overrides,
  })
  const service = await startService(config, options)
  const base = `http://127.0.0.1:${service.port}`

  const call = async (path: string, init?: RequestInit): Promise<Reply> => {
    const response = await fetch(base + path, init)

    return { status: response.status, body: await response.json() }
  }

  const post = (path: string, body: string | object) => call(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

  return {
    service,
    base,
    get: path => call(path),
    post,
    connect: async (deviceId, connected = true) => (await post('/connect', { deviceId, connected })).body as ConnectResult,
    stop: () => service.stop(),
  }
}

export const propertyOf = (cria: Cria, indiDevice: string, name: string) =>
  Option.getOrUndefined(Effect.runSync(cria.service.rig.client.device(indiDevice).property(name)))

export async function until<A>(what: string, probe: () => A | undefined | false | Promise<A | undefined | false>, timeoutMs = 15_000): Promise<A> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = await probe()

    if (found !== undefined && found !== false) return found
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`)
}
