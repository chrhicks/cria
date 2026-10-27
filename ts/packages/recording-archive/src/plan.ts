/**
 * Which frames of a recording are worth keeping: every image Vela saved and every autofocus sample.
 * Pure: the same evidence always gives the same plan, so the tests drive it with plain arrays.
 *
 * Vela's records name a Cria image by `provenance.imageId` (and the settled operation by `operationId`).
 * The recording holds the other half: a `capture` operation line whose outcome carries that image's id.
 * The operation line does not name the blob file, so the file is the image message of the same camera that
 * arrived inside the operation's `startedAt`..`settledAt` window. Cria runs one capture per camera at a time,
 * so the window holds one image. If it holds several, the exposure time and DATE-OBS in the FITS header
 * choose, and if they cannot, the frame is reported and nothing is guessed.
 * Autofocus records carry only each sample's `capturedAt`, which is Cria's own `capturedAt` of the image.
 */

/** A settled capture operation in the recording that delivered an image. */
export interface Capture {
  readonly operationId: string
  readonly imageId: string
  /** The camera's INDI device name (the operation's `expectedName`). */
  readonly device: string
  readonly startedAt: number
  readonly settledAt: number
  readonly capturedAt: number
  readonly capturedAtSource: string
  readonly exposureSeconds: number
}

/** An image message in `traffic.jsonl`, with the two header cards that identify an exposure. */
export interface Delivery {
  readonly path: string
  readonly device: string
  readonly at: number
  readonly exposureSeconds?: number
  /** DATE-OBS as epoch milliseconds. */
  readonly observedAt?: number
}

/** One image Vela has a frame record for. `capturedAt` is epoch milliseconds. */
export interface VelaFrame {
  readonly velaImageId: string
  readonly outcome: string
  readonly imageId: string | null
  readonly operationId: string | null
  readonly capturedAt: number
  readonly exposureSeconds: number
}

export interface AutofocusSample {
  readonly capturedAt: number
}

/** Frame records whose outcome holds an image that is the only copy, or that Vela saved. */
export const keptOutcomes: ReadonlySet<string> = new Set(['saved', 'save-failed'])

export interface Evidence {
  readonly captures: ReadonlyArray<Capture>
  readonly deliveries: ReadonlyArray<Delivery>
  /** Every file in `blobs/`, as `blobs/<name>`. */
  readonly blobFiles: ReadonlyArray<string>
  readonly velaFrames: ReadonlyArray<VelaFrame>
  readonly samples: ReadonlyArray<AutofocusSample>
  /** The session's span in epoch milliseconds: its start and its last line. */
  readonly window: { readonly from: number; readonly to: number }
}

export type UnmatchedReason =
  | 'image-not-in-recording'
  | 'operation-mismatch'
  | 'no-capture-at-that-time'
  | 'several-captures-at-that-time'
  | 'no-image-file'
  | 'several-image-files'
  | 'image-file-claimed-twice'
  | 'no-vela-records'

export interface Unmatched {
  readonly source: 'frame-record' | 'autofocus' | 'session'
  /** Vela's image id, or the sample's `capturedAt`. Empty for the session as a whole. */
  readonly id: string
  readonly reason: UnmatchedReason
}

export type PruneReason = 'not saved by Vela' | 'no Vela record of this capture' | 'no capture operation delivered this image' | 'not named by traffic.jsonl'

export interface FramePlan {
  readonly keep: ReadonlyArray<{ readonly path: string; readonly why: ReadonlyArray<string> }>
  readonly prune: ReadonlyArray<{ readonly path: string; readonly reason: PruneReason }>
  readonly unmatched: ReadonlyArray<Unmatched>
  /** Vela frame records matched by time and exposure because they carry no image id. */
  readonly matchedByTime: number
}

type Located = { readonly path: string } | { readonly error: 'no-image-file' | 'several-image-files' }

const headerAgrees = (capture: Capture, delivery: Delivery): boolean =>
  delivery.exposureSeconds !== undefined &&
  Math.abs(delivery.exposureSeconds - capture.exposureSeconds) < 1e-6 &&
  (capture.capturedAtSource !== 'camera' || delivery.observedAt === undefined || Math.floor(delivery.observedAt / 1000) === Math.floor(capture.capturedAt / 1000))

function locate(capture: Capture, deliveries: ReadonlyArray<Delivery>): Located {
  const inWindow = deliveries.filter(delivery => delivery.device === capture.device && delivery.at >= capture.startedAt && delivery.at <= capture.settledAt)
  const chosen = inWindow.length > 1 ? inWindow.filter(delivery => headerAgrees(capture, delivery)) : inWindow

  if (chosen.length === 1) return { path: chosen[0]!.path }

  return { error: inWindow.length === 0 ? 'no-image-file' : 'several-image-files' }
}

export function planFrames(evidence: Evidence): FramePlan {
  const { captures, deliveries, blobFiles, velaFrames, samples, window } = evidence
  const byImage = new Map(captures.map(capture => [capture.imageId, capture]))
  const inWindow = (at: number) => at >= window.from && at <= window.to
  const unmatched: Unmatched[] = []
  const wanted = new Map<string, { capture: Capture; why: string[]; id: Unmatched['id']; source: Unmatched['source'] }>()
  let matchedByTime = 0

  const want = (capture: Capture, why: string, source: Unmatched['source'], id: string) => {
    const entry = wanted.get(capture.imageId)

    if (entry) entry.why.push(why)
    else wanted.set(capture.imageId, { capture, why: [why], id, source })
  }
  const lost = (source: Unmatched['source'], id: string, reason: UnmatchedReason) => void unmatched.push({ source, id, reason })

  for (const frame of velaFrames) {
    if (!keptOutcomes.has(frame.outcome)) continue

    const label = `saved by Vela: ${frame.velaImageId}`

    if (frame.imageId !== null) {
      const capture = byImage.get(frame.imageId)

      if (capture === undefined) {
        if (inWindow(frame.capturedAt)) lost('frame-record', frame.velaImageId, 'image-not-in-recording')
      } else if (frame.operationId !== null && frame.operationId !== capture.operationId) lost('frame-record', frame.velaImageId, 'operation-mismatch')
      else want(capture, label, 'frame-record', frame.velaImageId)
      continue
    }

    const same = captures.filter(capture => capture.capturedAt === frame.capturedAt && capture.exposureSeconds === frame.exposureSeconds)

    if (same.length === 1) {
      matchedByTime += 1
      want(same[0]!, `${label} (matched by time)`, 'frame-record', frame.velaImageId)
    } else if (same.length > 1) lost('frame-record', frame.velaImageId, 'several-captures-at-that-time')
    else if (inWindow(frame.capturedAt)) lost('frame-record', frame.velaImageId, 'no-capture-at-that-time')
  }

  for (const sample of samples) {
    const same = captures.filter(capture => capture.capturedAt === sample.capturedAt)

    if (same.length === 1) want(same[0]!, 'autofocus sample', 'autofocus', String(sample.capturedAt))
    else if (same.length > 1) lost('autofocus', String(sample.capturedAt), 'several-captures-at-that-time')
    else if (inWindow(sample.capturedAt)) lost('autofocus', String(sample.capturedAt), 'no-capture-at-that-time')
  }

  if (captures.length > 0 && velaFrames.every(frame => !inWindow(frame.capturedAt)) && samples.every(sample => !inWindow(sample.capturedAt))) lost('session', '', 'no-vela-records')

  const located = new Map(captures.map(capture => [capture.imageId, locate(capture, deliveries)]))
  const claims = new Map<string, number>()

  for (const place of located.values()) if ('path' in place) claims.set(place.path, (claims.get(place.path) ?? 0) + 1)

  const kept = new Map<string, string[]>()

  for (const { capture, why, id, source } of wanted.values()) {
    const place = located.get(capture.imageId)!

    if (!('path' in place)) lost(source, id, place.error)
    else if (claims.get(place.path)! > 1) lost(source, id, 'image-file-claimed-twice')
    else kept.set(place.path, [...(kept.get(place.path) ?? []), ...why])
  }

  const delivered = new Set(deliveries.map(delivery => delivery.path))
  const ownerOf = new Map(captures.flatMap(capture => {
    const place = located.get(capture.imageId)!

    return 'path' in place ? [[place.path, capture] as const] : []
  }))
  const recorded = new Set(velaFrames.map(frame => frame.imageId ?? `time:${frame.capturedAt}`))
  const reasonOf = (path: string): PruneReason => {
    const owner = ownerOf.get(path)

    if (!delivered.has(path)) return 'not named by traffic.jsonl'
    if (owner === undefined) return 'no capture operation delivered this image'

    return recorded.has(owner.imageId) || recorded.has(`time:${owner.capturedAt}`) ? 'not saved by Vela' : 'no Vela record of this capture'
  }

  return {
    keep: [...kept].map(([path, why]) => ({ path, why })).sort((a, b) => (a.path < b.path ? -1 : 1)),
    prune: blobFiles.filter(path => !kept.has(path)).map(path => ({ path, reason: reasonOf(path) })),
    unmatched,
    matchedByTime,
  }
}
