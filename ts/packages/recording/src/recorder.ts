/**
 * The recorder. Cria's INDI client reports every element to it through the
 * traffic tap; one consumer writes them to the recording folder.
 *
 * `message` and `connection` return at once and never throw, so a slow or
 * broken disk cannot reach the socket. Pending entries wait in a queue bounded
 * in bytes, because one entry can hold a 52 MB image.
 *
 * Recording stops for good at the first failure: a full queue, a disk below its
 * reserve, or an I/O error. There is no resume, because a half-written line in
 * the middle of the file would corrupt everything after it. The next Cria start
 * opens a new recording. Cria keeps observing in every case.
 *
 * Write order for one entry, which is the whole crash-safety argument:
 *
 *   for each image: write image.partial, fsync it, rename it, fsync the folder
 *   then append the entry's line
 *
 * A line therefore never names an image that is not on disk. A crash between
 * the two leaves an image no line names, which is harmless. A crash inside the
 * append leaves a torn last line, which the reader drops.
 */
import type { TappedConnection, TappedMessage, TrafficTap } from '@cria/indi'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { blobPath, blobsDirectory, manifestFile, type GapReason, type Manifest, type RecordingLine } from './format.js'
import { openRecordingFiles, type RecordingFiles } from './files.js'

export interface RecordConfig {
  readonly dir: string
  readonly reserveBytes: number
  readonly queueBytes: number
}

export interface RecorderIdentity {
  readonly instanceId: string
  readonly indi: Manifest['indi']
  readonly devices: Manifest['devices']
}

export interface Clock {
  readonly wall: () => number
  readonly monotonic: () => number
}

export interface RecorderDeps {
  readonly files?: (folder: string) => Promise<RecordingFiles>
  readonly clock?: Clock
  /** Told once, when recording stops for good. */
  readonly onLatch?: (reason: GapReason, cause: unknown) => void
}

export interface Recorder extends TrafficTap {
  readonly folder: string
  readonly latched: () => GapReason | undefined
  /** Bytes held in the queue, the entry being written included. */
  readonly queuedBytes: () => number
  /** Drains the queue, then writes `end` if the file is still sound. Never rejects; waits as long as the disk does. Safe to call twice. */
  readonly close: () => Promise<void>
  /**
   * For a close that gave up waiting on a stalled disk: stops recording and
   * lets go of the traffic file without waiting for it. Closing a file handle
   * waits for its outstanding writes, so this must not.
   */
  readonly abandon: () => void
}

interface Entry {
  readonly line: RecordingLine
  readonly images: ReadonlyArray<{ readonly path: string; readonly bytes: Buffer }>
  readonly cost: number
}

type Gate =
  | { readonly kind: 'recording' }
  | { readonly kind: 'latched'; readonly reason: GapReason; readonly dropped: { entries: number; bytes: number } }

const perEntryBytes = 256
const freeSpaceCheckMs = 1000
const syncMs = 1000

const systemClock: Clock = {
  // Recording times are wire timestamps, read once per entry.
  wall: () => Date.now(),
  monotonic: () => performance.now(),
}

export const recordingName = (startedAt: number, instanceId: string): string =>
  `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${instanceId}`

export async function openRecorder(config: RecordConfig, identity: RecorderIdentity, deps: RecorderDeps = {}): Promise<Recorder> {
  const clock = deps.clock ?? systemClock
  const startedAt = clock.wall()
  const startedMonotonic = clock.monotonic()
  const name = recordingName(startedAt, identity.instanceId)
  const folder = join(config.dir, name)
  const files = await (deps.files ?? openRecordingFiles)(folder)

  const manifest: Manifest = {
    format: 1,
    recording: name,
    instanceId: identity.instanceId,
    startedAt,
    indi: identity.indi,
    devices: identity.devices,
    limits: { queueBytes: config.queueBytes, reserveBytes: config.reserveBytes },
  }

  try {
    await files.writeFile(`${manifestFile}.partial`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
    await files.syncFile(`${manifestFile}.partial`)
    await files.rename(`${manifestFile}.partial`, manifestFile)
    await files.syncDirectory('')
  } catch (error) {
    // An open traffic file nobody holds is closed by the garbage collector, which Node now treats as an error.
    await Promise.allSettled([files.close()])
    throw error
  }

  const queue: Entry[] = []
  const ordinals = new Map<string, number>()
  let gate: Gate = { kind: 'recording' }
  let queuedBytes = 0
  let wake: (() => void) | undefined
  let closing = false
  let appendInterrupted = false
  let lastFreeCheck = startedMonotonic
  let lastSync = startedMonotonic
  let unsynced = false

  const stamp = () => ({ t: Math.round((clock.monotonic() - startedMonotonic) * 1000) / 1000, at: clock.wall() })

  const latch = (reason: GapReason, cause: unknown, incoming = 0) => {
    if (gate.kind === 'latched') return
    const dropped = { entries: queue.length + (incoming > 0 ? 1 : 0), bytes: incoming + queue.reduce((total, entry) => total + entry.cost, 0) }

    queuedBytes -= queue.reduce((total, entry) => total + entry.cost, 0)
    queue.length = 0
    gate = { kind: 'latched', reason, dropped }
    wake?.()
    deps.onLatch?.(reason, cause)
  }

  const accept = (cost: number, build: () => Entry) => {
    if (closing) return
    if (gate.kind === 'latched') {
      gate.dropped.entries += 1
      gate.dropped.bytes += cost

      return
    }

    if (queuedBytes + cost > config.queueBytes) {
      latch('queue-full', `${queuedBytes + cost} bytes would pass the ${config.queueBytes} byte queue`, cost)

      return
    }

    queue.push(build())
    queuedBytes += cost
    wake?.()
  }

  // A bug in building an entry must stop recording, not reach the socket handler that called the tap.
  const guarded = (work: () => void) => {
    try {
      work()
    } catch (error) {
      latch('io-error', error)
    }
  }

  const tap: TrafficTap = {
    message: message =>
      guarded(() => {
        const cost = perEntryBytes + message.xml.length + message.blobs.reduce((total, blob) => total + blob.length, 0)

        accept(cost, () => messageEntry(message, cost))
      }),
    connection: connection => guarded(() => accept(perEntryBytes, () => connectionEntry(connection))),
  }

  const messageEntry = (message: TappedMessage, cost: number): Entry => {
    const key = `${message.conn}:${message.dir}`
    const n = ordinals.get(key) ?? 0
    const paths = message.blobs.map((_, index) => blobPath(message.conn, n, index))

    ordinals.set(key, n + 1)

    return {
      line: {
        k: 'msg',
        ...stamp(),
        conn: message.conn,
        dir: message.dir,
        n,
        xml: paths.length === 0 ? message.xml : withRefs(message.xml, paths),
        ...(paths.length === 0 ? {} : { blobs: paths }),
      },
      images: message.blobs.map((bytes, index) => ({ path: paths[index]!, bytes })),
      cost,
    }
  }

  const connectionEntry = (connection: TappedConnection): Entry => ({
    line: {
      k: 'conn',
      ...stamp(),
      conn: connection.conn,
      status: connection.status,
      ...(connection.status === 'closed' ? { error: connection.error } : {}),
    },
    images: [],
    cost: perEntryBytes,
  })

  const append = async (line: RecordingLine) => {
    appendInterrupted = true
    await files.appendLine(`${JSON.stringify(line)}\n`)
    appendInterrupted = false
    unsynced = true
  }

  const sync = async () => {
    await files.syncTraffic()
    lastSync = clock.monotonic()
    unsynced = false
  }

  const hasRoomFor = async (imageBytes: number) => {
    const now = clock.monotonic()

    if (imageBytes === 0 && now - lastFreeCheck < freeSpaceCheckMs) return true
    lastFreeCheck = now

    return (await files.freeBytes()) - imageBytes >= config.reserveBytes
  }

  // An I/O error is a reason to stop recording, never a reason to fail: Cria keeps observing.
  const stopOnFailure = async (work: () => Promise<void>, lost = 0) => {
    try {
      await work()
    } catch (error) {
      latch('io-error', error, lost)
    }
  }

  const write = (entry: Entry) =>
    stopOnFailure(async () => {
      if (!(await hasRoomFor(entry.images.reduce((total, image) => total + image.bytes.length, 0)))) {
        latch('low-disk', 'free space would drop below the reserve', entry.cost)

        return
      }

      for (const image of entry.images) {
        await files.writeFile(`${image.path}.partial`, image.bytes)
        await files.syncFile(`${image.path}.partial`)
        await files.rename(`${image.path}.partial`, image.path)
        await files.syncDirectory(blobsDirectory)
      }

      await append(entry.line)
      if (clock.monotonic() - lastSync >= syncMs) await sync()
    }, entry.cost)

  const consume = async () => {
    while (gate.kind === 'recording') {
      const entry = queue.shift()

      if (!entry) {
        if (unsynced) await stopOnFailure(sync)
        if (closing) return
        await new Promise<void>(resolve => {
          wake = resolve
        })
        wake = undefined
        continue
      }

      await write(entry)
      queuedBytes -= entry.cost
    }

    if (gate.kind === 'latched' && !appendInterrupted) {
      const { reason, dropped } = gate

      await stopOnFailure(() => append({ k: 'gap', ...stamp(), reason, dropped }))
    }
  }

  // Nothing is appended after an append that may have left a torn line.
  const finish = async () => {
    try {
      if (!appendInterrupted) {
        await append({ k: 'end', ...stamp() })
        await sync()
      }
    } catch (error) {
      deps.onLatch?.('io-error', error)
    }
    await release()
  }

  // The recording is over; a close that fails has nothing left to report to.
  const release = async () => {
    await Promise.allSettled([files.close()])
  }
  let closed: Promise<void> | undefined

  const consuming = consume()

  return {
    folder,
    message: tap.message,
    connection: tap.connection,
    latched: () => (gate.kind === 'latched' ? gate.reason : undefined),
    queuedBytes: () => queuedBytes,
    close: () =>
      (closed ??= (async () => {
        closing = true
        wake?.()
        await consuming
        await finish()
      })()),
    abandon: () => {
      latch('io-error', 'abandoned at shutdown')
      void release()
    },
  }
}

/** Pure: adds `ref="<path>"` to the nth self-closing `oneBLOB`. `paths` has one entry per elided payload. */
export function withRefs(xml: string, paths: ReadonlyArray<string>): string {
  let index = 0

  return xml.replace(/<oneBLOB\b[^>]*?\/>/g, element => {
    const path = paths[index]

    index += 1

    return path === undefined ? element : `${element.slice(0, -2).trimEnd()} ref="${path}"/>`
  })
}
