/**
 * Test support: a running Cria service against some INDI server, driven over
 * HTTP the way Vela drives it. Everything goes through the typed client in
 * testing/cria-client.ts, so every scenario also checks the protocol 5
 * contract.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Device, Operation, OperationRequest, State } from '@cria/wire'
import { makeCriaClient, type CriaClient, type Reply } from '../../../testing/cria-client.js'
import { decodeConfig } from '../src/config.js'
import { startService, type RunningService } from '../src/service.js'

export type { Device, Operation, State }

type Settled = Extract<Operation, { readonly state: 'settled' }>

export interface DeviceSpec {
  readonly id: string
  readonly kind: 'camera' | 'mount' | 'focuser' | 'weather' | 'switch'
  readonly indiDevice: string
  readonly connect?: boolean
  readonly channels?: ReadonlyArray<{ name: string; property: string; element: string; automaticWhileOn?: string }>
  readonly frameGrid?: { readonly width?: number; readonly height?: number }
  readonly site?: { readonly latitudeDegrees: number; readonly longitudeDegrees: number; readonly elevationMeters: number }
  readonly motion?: { readonly stationaryDegrees?: number; readonly positionReadMs?: number; readonly stopLatencyMs?: number; readonly maxLeadFraction?: number }
  readonly travel?: { readonly min: number; readonly max: number }
}

/**
 * A settled operation as tests assert on it: its Outcome flattened, and
 * whether its device is quarantined once it settled (a device fact in
 * protocol 5, read from the state right after).
 */
export interface Ending {
  readonly id: string
  readonly state: Settled['state']
  readonly kind: Settled['outcome']['kind']
  readonly reason: string | null
  readonly message: string | null
  readonly values: Readonly<Record<string, unknown>> | null
  readonly image: Extract<Settled['outcome'], { kind: 'confirmed' }>['value']['image']
  readonly quarantined: boolean
  readonly operation: Settled
}

export interface Cria {
  readonly service: RunningService
  readonly base: string
  readonly client: CriaClient
  readonly state: () => Promise<State>
  readonly device: (id: string) => Promise<Device>
  /** Submits an operation the way Vela does, with a fresh request ID unless one is given. */
  readonly submit: (deviceId: string, kind: string, parameters: object, requestId?: string) => Promise<Reply<Operation>>
  readonly cancel: (operationId: string) => Promise<Reply<Operation>>
  readonly settled: (operationId: string, timeoutMs?: number) => Promise<Ending>
  readonly run: (deviceId: string, kind: string, parameters: object) => Promise<Ending>
  readonly waitFor: (predicate: (state: State) => boolean, timeoutMs?: number) => Promise<State>
  readonly stop: () => Promise<void>
}

export function ending(operation: Settled, quarantined: boolean): Ending {
  const outcome = operation.outcome

  return {
    id: operation.id,
    state: operation.state,
    kind: outcome.kind,
    reason: 'reason' in outcome ? outcome.reason : null,
    message: 'message' in outcome ? outcome.message : null,
    values: outcome.kind === 'confirmed' ? outcome.value.values : null,
    image: outcome.kind === 'confirmed' ? outcome.value.image : null,
    quarantined,
    operation,
  }
}

export async function startCria(
  indiPort: number,
  devices: ReadonlyArray<DeviceSpec>,
  overrides: object = {},
  options: { readonly token?: string } = {},
): Promise<Cria> {
  const imageDirectory = await mkdtemp(join(tmpdir(), 'cria-test-images-'))
  const config = decodeConfig({
    listen: { host: '127.0.0.1', port: 0 },
    indi: { host: '127.0.0.1', port: indiPort },
    imageDirectory,
    livenessMs: 500,
    acknowledgeMs: 2000,
    operationTimeoutMs: 20_000,
    devices,
    ...overrides,
  })
  const service = await startService(config, options)
  const base = `http://127.0.0.1:${service.port}`
  const client = makeCriaClient(base)

  const state = () => client.state()

  const device = async (id: string) => {
    const found = (await state()).devices.find(candidate => candidate.id === id)

    if (!found) throw new Error(`No device ${id}`)

    return found
  }

  const waitFor = async (predicate: (state: State) => boolean, timeoutMs = 15_000) => {
    let last: State | undefined

    try {
      return await until(
        'the state to match',
        async () => {
          last = await state()

          return predicate(last) && last
        },
        timeoutMs,
      )
    } catch (error) {
      throw new Error(`${(error as Error).message}; last state ${JSON.stringify(last?.devices.map(d => [d.id, d.availability, d.quarantine]))}`)
    }
  }

  const submit = async (deviceId: string, kind: string, parameters: object, requestId = crypto.randomUUID()) => {
    const current = await state()
    const target = current.devices.find(candidate => candidate.id === deviceId)!

    // Tests send what Vela would; a malformed command is the server's to refuse.
    return client.submit({
      instanceId: current.instanceId,
      requestId,
      deviceId,
      bindingId: target.bindingId,
      expectedName: target.name,
      kind,
      parameters,
    } as unknown as OperationRequest)
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

    return ending(operation, (await device(operation.deviceId)).quarantine.held)
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
    state,
    device,
    submit,
    cancel: id => client.cancel(id),
    settled,
    run,
    waitFor,
    stop: async () => {
      await service.stop()
      await rm(imageDirectory, { recursive: true, force: true })
    },
  }
}

export const noneNotRead = (state: State) => !JSON.stringify(state.devices).includes('"reason":"not-read"')

export const allReady = (ids: ReadonlyArray<string>) => (state: State) =>
  ids.every(id => state.devices.find(device => device.id === id)?.availability.ready === true)

/** The value of a fresh or stale reading, or the reason it is unavailable. */
export function valueOf(device: Device, key: string): unknown {
  const reading = (device.readings as Record<string, Device['readings']['connected']>)[key]

  if (!reading) return undefined

  return reading.status === 'unavailable' ? reading.reason : reading.value
}

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
