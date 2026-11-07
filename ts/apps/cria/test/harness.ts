/**
 * Test support: a running Cria service against some INDI server, driven over
 * HTTP the way Vela drives it. Everything goes through the typed client in
 * testing/cria-client.ts, so every scenario also checks the protocol 5
 * contract.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Option } from 'effect'
import type { Operation, OperationRequest } from '@cria/wire'
import { makeCriaClient, type CriaClient, type Reply } from '../../../testing/cria-client.js'
import { decodeConfig } from '../src/config.js'
import { startService, type RunningService } from '../src/service.js'
import type { OpenPublisher } from '../src/stream.js'

export type { Operation }

type Settled = Extract<Operation, { readonly state: 'settled' }>

export interface DeviceSpec {
  readonly id: string
  readonly kind: 'camera' | 'mount' | 'focuser' | 'box'
  readonly indiDevice: string
  readonly channels?: ReadonlyArray<{ name: string; property: string; element: string; automaticWhileOn?: string }>
  readonly site?: { readonly latitudeDegrees: number; readonly longitudeDegrees: number; readonly elevationMeters: number }
  readonly motion?: { readonly stationaryDegrees?: number; readonly positionReadMs?: number; readonly stopLatencyMs?: number }
  readonly travel?: { readonly min: number; readonly max: number }
}

/** A settled operation as tests assert on it: its Outcome flattened. */
export interface Ending {
  readonly id: string
  readonly state: Settled['state']
  readonly kind: Settled['outcome']['kind']
  readonly reason: string | null
  readonly message: string | null
  readonly values: Readonly<Record<string, unknown>> | null
  readonly image: Extract<Settled['outcome'], { kind: 'confirmed' }>['value']['image']
  readonly operation: Settled
}

export interface Cria {
  readonly service: RunningService
  readonly base: string
  readonly client: CriaClient
  /** Submits an operation the way Vela does, with a fresh request ID unless one is given. */
  readonly submit: (deviceId: string, kind: string, parameters: object, requestId?: string) => Promise<Reply<Operation>>
  readonly cancel: (operationId: string) => Promise<Reply<Operation>>
  readonly operationState: (operationId: string) => Promise<Operation['state']>
  readonly settled: (operationId: string, timeoutMs?: number) => Promise<Ending>
  readonly run: (deviceId: string, kind: string, parameters: object) => Promise<Ending>
  readonly stop: () => Promise<void>
}

export function ending(operation: Settled): Ending {
  const outcome = operation.outcome

  return {
    id: operation.id,
    state: operation.state,
    kind: outcome.kind,
    reason: 'reason' in outcome ? outcome.reason : null,
    message: 'message' in outcome ? outcome.message : null,
    values: outcome.kind === 'confirmed' ? outcome.value.values : null,
    image: outcome.kind === 'confirmed' ? outcome.value.image : null,
    operation,
  }
}

export async function startCria(
  indiPort: number,
  devices: ReadonlyArray<DeviceSpec>,
  overrides: object = {},
  options: { readonly stream?: OpenPublisher } = {},
): Promise<Cria> {
  const imageDirectory = await mkdtemp(join(tmpdir(), 'cria-test-images-'))
  const config = decodeConfig({
    listen: { host: '127.0.0.1', port: 0 },
    indi: { host: '127.0.0.1', port: indiPort },
    imageDirectory,
    acknowledgeMs: 2000,
    operationTimeoutMs: 20_000,
    devices,
    ...overrides,
  })
  const service = await startService(config, options)
  const base = `http://127.0.0.1:${service.port}`
  const client = makeCriaClient(base)

  const submit = async (deviceId: string, kind: string, parameters: object, requestId = crypto.randomUUID()) => {
    const { instanceId } = await client.health()

    // Tests send what Vela would; a malformed command is the server's to refuse.
    return client.submit({
      instanceId,
      requestId,
      deviceId,
      kind,
      parameters,
    } as unknown as OperationRequest)
  }

  const operationState = async (operationId: string) => {
    const reply = await client.operation(operationId)

    if (!reply.ok) throw new Error(`No operation ${operationId}: ${reply.body.error.code}`)

    return reply.body.state
  }

  const settled = async (operationId: string, timeoutMs = 60_000) => {
    const operation = await until(
      `operation ${operationId} to settle`,
      async () => {
        const reply = await client.operation(operationId)

        return reply.ok && reply.body.state === 'settled' && reply.body
      },
      timeoutMs,
    )

    return ending(operation)
  }

  const run = async (deviceId: string, kind: string, parameters: object) => {
    const submitted = await submit(deviceId, kind, parameters)

    if (!submitted.ok) throw new Error(`Submit refused ${submitted.status}: ${JSON.stringify(submitted.body)}`)

    return settled(submitted.body.id)
  }

  return {
    service,
    base,
    client,
    submit,
    cancel: id => client.cancel(id),
    operationState,
    settled,
    run,
    stop: async () => {
      await service.stop()
      await rm(imageDirectory, { recursive: true, force: true })
    },
  }
}

export async function connectDevices(cria: Cria, ids: ReadonlyArray<string>): Promise<ReadonlyArray<Ending>> {
  const endings: Ending[] = []

  for (const id of ids) endings.push(await cria.run(id, 'device-connect', { connected: true }))

  return endings
}

export const propertyOf = (cria: Cria, indiDevice: string, name: string) =>
  Option.getOrUndefined(Effect.runSync(cria.service.rig.client.device(indiDevice).property(name)))

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function until<A>(what: string, probe: () => A | undefined | false | Promise<A | undefined | false>, timeoutMs = 15_000): Promise<A> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = await probe()

    if (found !== undefined && found !== false) return found
    await sleep(25)
  }

  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`)
}
