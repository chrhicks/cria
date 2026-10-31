import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import { Device, Image, Operation } from '@cria/wire'

export const instanceId = '6f1b2b0e-5b8c-4a6e-9c3e-0d2f6a1d7c11'
export const operationId = '0d6f1c6e-7a53-4f0a-8c1e-2b9d4a7e5f10'
export const imageId = '3a1d5c9e-2f4b-4e86-9a0c-7d8e6f5a4b32'
export const requestId = 'capture-1'

const identity = {
  instanceId,
  requestId,
  deviceId: 'camera',
  bindingId: '9b7c3d2e-1f0a-4c5b-8d6e-5a4f3e2d1c0b',
  expectedName: 'Fake CCD',
}

const accepted = { id: operationId, ...identity, failureDomain: 'camera', acceptedAt: 1_793_361_600_000 }
const capture = { kind: 'capture', parameters: { exposureSeconds: 1, light: true } }

export const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export const imageOf = (bytes: Uint8Array, id = imageId) => ({
  id,
  operationId,
  instanceId,
  deviceId: 'camera',
  cameraName: 'Fake CCD',
  bindingId: identity.bindingId,
  width: 8,
  height: 6,
  binX: 1,
  binY: 1,
  startX: 0,
  startY: 0,
  exposureSeconds: 1,
  color: 'mono',
  capturedAt: 1_793_361_601_000,
  capturedAtSource: 'camera',
  retainedAt: 1_793_361_602_000,
  sha256: sha256Of(bytes),
  original: { mediaType: 'application/imagebytes', bytes: bytes.length, url: `/v2/images/${id}/original` },
})

export const running = { ...accepted, state: 'running', startedAt: 1_793_361_600_500, progress: { phase: 'exposing', elapsedSeconds: 0.5 }, ...capture }

export const confirmed = (image: unknown) => ({
  ...accepted,
  state: 'settled',
  startedAt: 1_793_361_600_500,
  settledAt: 1_793_361_602_500,
  outcome: { kind: 'confirmed', value: { values: {}, image } },
  recovery: null,
  ...capture,
})

export const failed = {
  ...accepted,
  state: 'settled',
  startedAt: 1_793_361_600_500,
  settledAt: 1_793_361_602_500,
  outcome: { kind: 'failed', reason: 'rejected', message: 'The camera refused the exposure' },
  recovery: null,
  ...capture,
}

export const notFound = { error: { code: 'not-found', message: 'No such operation' }, instanceId }

/** The fixtures are the wire's own shapes, so a drifting wire fails here and not in a confusing tool test. */
export const decodesAsWire = (operation: unknown) => Schema.decodeUnknownSync(Operation)(operation, { onExcessProperty: 'error' })
export const decodesAsImage = (image: unknown) => Schema.decodeUnknownSync(Image)(image, { onExcessProperty: 'error' })

export const mountId = {
  instanceId,
  requestId: 'rotate-1',
  deviceId: 'mount',
  bindingId: '4c2f8a10-6d3e-4b7a-9f15-8e0d1c2b3a49',
  expectedName: 'Fake Mount',
}

export const rotation = { rateDegreesPerSecond: 0.25, distanceDegrees: 10 }

/** What an agent sends to `mount-rotate`: the identity from state, the agent's requestId and the parameters. */
export const rotateInput = { ...mountId, parameters: rotation }

/** The operation Cria answers a `mount-rotate` with at 202. */
export const rotating = {
  id: operationId,
  ...mountId,
  failureDomain: 'mount',
  acceptedAt: 1_793_361_600_000,
  state: 'running',
  startedAt: 1_793_361_600_100,
  progress: { phase: 'preparing', elapsedSeconds: null },
  kind: 'mount-rotate',
  parameters: rotation,
}

const fresh = (value: unknown) => ({ status: 'fresh', value, observedAt: 1_793_361_600_000 })

/** A switch device, the smallest device body the wire has; `held` says whether Cria holds it. */
export const switchDevice = (held: boolean) => ({
  id: 'power',
  name: 'Fake Switch',
  bindingId: '7a1e5d30-2b4c-4f69-8a0d-3c9b1e5f7a21',
  failureDomain: 'power',
  availability: { ready: true },
  quarantine: held ? { held: true, reason: 'uncertain', since: 1_793_361_600_000 } : { held: false },
  afterOperation: null,
  kind: 'switch',
  readings: { connected: fresh(true), name: fresh('Fake Switch'), channelCount: fresh(0) },
  channels: [],
})

export const decodesAsDevice = (device: unknown) => Schema.decodeUnknownSync(Device)(device, { onExcessProperty: 'error' })
