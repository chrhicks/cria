/**
 * INDI boundary: the client. One TCP connection to indiserver, the property
 * mirror it feeds, and `IndiDevice`, the narrow face capabilities use.
 *
 * Failure meanings are decided here once: a request that could not be written
 * fails `not-connected` (nothing was sent); a request whose write failed or
 * whose connection dropped afterwards fails `connection-lost` (it may have been
 * received). Nothing is ever resent by this layer.
 */
import net from 'node:net'
import { Data, Effect, Option, PubSub, Scope, Stream, SubscriptionRef } from 'effect'
import { Mirror, type Blob, type MirrorChange, type Property } from './mirror.js'
import type { TrafficTap } from './tap.js'
import { IndiFramer, serialize, type BlobMode, type IndiMessage, type IndiRequest } from './xml.js'

export type ConnectionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected'; readonly since: number }
  | { readonly kind: 'disconnected'; readonly since: number; readonly error: string }

export type IndiErrorReason = 'not-connected' | 'connection-lost' | 'unknown-property' | 'not-writable'

export class IndiError extends Data.TaggedError('IndiError')<{
  readonly reason: IndiErrorReason
  readonly message: string
}> {}

/** What a capability can observe about one INDI device. */
export type DeviceEvent =
  | { readonly type: 'property'; readonly origin: 'def' | 'set'; readonly property: Property }
  | { readonly type: 'deleted'; readonly name?: string }
  | { readonly type: 'blob'; readonly blob: Blob }
  | { readonly type: 'connection'; readonly status: ConnectionStatus }

export interface DeviceSubscription {
  /** The next event for this device, waiting if there is none yet. */
  readonly next: Effect.Effect<DeviceEvent>
}

export type Values = Readonly<Record<string, number | boolean | string>>

export interface IndiDevice {
  readonly name: string
  readonly property: (name: string) => Effect.Effect<Option.Option<Property>>
  readonly properties: Effect.Effect<ReadonlyArray<Property>>
  /** Subscribe before sending a command so its answer can't be missed. */
  readonly subscribe: Effect.Effect<DeviceSubscription, never, Scope.Scope>
  readonly events: Stream.Stream<DeviceEvent>
  /** One new*Vector. Sent exactly once; never retried here. */
  readonly send: (property: string, values: Values) => Effect.Effect<void, IndiError>
  /**
   * A liveness read: asks the driver to define `property` again and waits for
   * that definition. Proves the driver is alive and answering.
   */
  readonly read: (property: string) => Effect.Effect<Property, IndiError>
  readonly enableBlobs: (mode: BlobMode) => Effect.Effect<void, IndiError>
}

export interface IndiClient {
  readonly status: Effect.Effect<ConnectionStatus>
  readonly device: (name: string) => IndiDevice
}

export interface IndiClientOptions {
  readonly host: string
  readonly port: number
  /** Told of every element sent and received. Absent, the client behaves exactly as without recording. */
  readonly tap?: TrafficTap
}

type ClientEvent = { readonly device?: string; readonly event: DeviceEvent }

export function makeIndiClient(options: IndiClientOptions): Effect.Effect<IndiClient, never, Scope.Scope> {
  return Effect.gen(function* () {
    const mirror = new Mirror()
    const status = yield* SubscriptionRef.make<ConnectionStatus>({ kind: 'connecting' })
    const events = yield* PubSub.unbounded<ClientEvent>()
    let socket: net.Socket | undefined
    let connectionNumber = 0

    const publish = (event: ClientEvent) => {
      PubSub.publishUnsafe(events, event)
    }

    const setStatus = (next: ConnectionStatus) => {
      Effect.runSync(SubscriptionRef.set(status, next))
      publish({ event: { type: 'connection', status: next } })
    }

    const tap = options.tap

    // The one place Cria writes to indiserver: what it meant to send is recorded before the write.
    const transmit = (request: IndiRequest, current: net.Socket, onWritten?: (error?: Error | null) => void) => {
      const text = serialize(request)

      tap?.message({ conn: connectionNumber, dir: 'out', xml: text, blobs: [] })
      current.write(text, onWritten)
    }

    const write = (request: IndiRequest, current: net.Socket) =>
      Effect.callback<void, IndiError>(resume => {
        transmit(request, current, error => {
          resume(
            error
              ? Effect.fail(new IndiError({ reason: 'connection-lost', message: `INDI write failed: ${error.message}` }))
              : Effect.void,
          )
        })
      })

    const send = (request: IndiRequest) =>
      Effect.suspend(() => {
        if (!socket || socket.destroyed || !socket.writable)
          return Effect.fail(new IndiError({ reason: 'not-connected', message: 'Not connected to indiserver' }))

        return write(request, socket)
      })

    const receive = (message: IndiMessage, current: net.Socket) => {
      if (message.type === 'pingRequest') {
        transmit({ type: 'pingReply', uid: message.uid }, current)

        return
      }

      for (const change of mirror.apply(message, Date.now())) publish(toClientEvent(change))
    }

    // One session per TCP connection; resolves when the socket closes.
    const session = Effect.callback<string>(resume => {
      const framer = new IndiFramer()
      const current = net.connect({ host: options.host, port: options.port })
      let lastError = 'connection closed'

      connectionNumber += 1
      socket = current
      current.setNoDelay(true)
      current.on('connect', () => {
        tap?.connection({ conn: connectionNumber, status: 'connected' })
        setStatus({ kind: 'connected', since: Date.now() })
        transmit({ type: 'getProperties' }, current)
      })
      current.on('data', (chunk: Buffer) => {
        try {
          if (tap) {
            for (const { message, xml, blobs } of framer.pushFramed(chunk)) {
              tap.message({ conn: connectionNumber, dir: 'in', xml, blobs })
              if (message) receive(message, current)
            }
          } else {
            for (const message of framer.push(chunk)) receive(message, current)
          }
        } catch (error) {
          current.destroy(error instanceof Error ? error : new Error(String(error)))
        }
      })
      current.on('error', error => {
        lastError = error.message
      })
      current.on('close', () => {
        tap?.connection({ conn: connectionNumber, status: 'closed', error: lastError })
        resume(Effect.succeed(lastError))
      })

      return Effect.sync(() => current.destroy())
    })

    const connectForever = Effect.gen(function* () {
      let delay = 250

      while (true) {
        const startedAt = Date.now()
        const error = yield* session

        socket = undefined
        setStatus({ kind: 'disconnected', since: Date.now(), error })
        if (Date.now() - startedAt > 10_000) delay = 250
        yield* Effect.sleep(delay)
        delay = Math.min(delay * 2, 5000)
        setStatus({ kind: 'connecting' })
      }
    })

    yield* Effect.forkScoped(connectForever)
    yield* Effect.addFinalizer(() => Effect.sync(() => socket?.destroy()))

    const subscribeDevice = (name: string) =>
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(events)
        const next: Effect.Effect<DeviceEvent> = Effect.gen(function* () {
          while (true) {
            const item = yield* PubSub.take(subscription)

            if (item.device === undefined || item.device === name) return item.event
          }
        })

        return { next }
      })

    const device = (name: string): IndiDevice => {
      const property = (property: string) => Effect.sync(() => Option.fromNullishOr(mirror.property(name, property)))

      const sendVector = (propertyName: string, values: Values) =>
        Effect.gen(function* () {
          const known = mirror.property(name, propertyName)

          if (!known)
            return yield* new IndiError({ reason: 'unknown-property', message: `${name} has no property ${propertyName}` })
          if (known.perm === 'ro' || known.kind === 'light' || known.kind === 'blob')
            return yield* new IndiError({ reason: 'not-writable', message: `${name}.${propertyName} is read-only` })

          yield* send({ type: 'new', kind: known.kind, device: name, name: propertyName, values })
        })

      const read = (propertyName: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* subscribeDevice(name)

            yield* send({ type: 'getProperties', device: name, name: propertyName })

            while (true) {
              const event = yield* subscription.next

              if (event.type === 'property' && event.origin === 'def' && event.property.name === propertyName)
                return event.property
              if (event.type === 'connection' && event.status.kind !== 'connected')
                return yield* new IndiError({ reason: 'connection-lost', message: 'indiserver connection lost during read' })
            }
          }),
        )

      return {
        name,
        property,
        properties: Effect.sync(() => mirror.properties(name)),
        subscribe: subscribeDevice(name),
        events: Stream.fromPubSub(events).pipe(
          Stream.filter(item => item.device === undefined || item.device === name),
          Stream.map(item => item.event),
        ),
        send: sendVector,
        read,
        enableBlobs: mode => send({ type: 'enableBLOB', device: name, mode }),
      }
    }

    return {
      status: SubscriptionRef.get(status),
      device,
    }
  })
}

function toClientEvent(change: MirrorChange): ClientEvent {
  switch (change.type) {
    case 'property':
      return { device: change.property.device, event: { type: 'property', origin: change.origin, property: change.property } }
    case 'deleted':
      return {
        device: change.device,
        event: change.name === undefined ? { type: 'deleted' } : { type: 'deleted', name: change.name },
      }
    case 'blob':
      return { device: change.blob.device, event: { type: 'blob', blob: change.blob } }
  }
}
