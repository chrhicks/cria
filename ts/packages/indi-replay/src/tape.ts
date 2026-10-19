/**
 * A recording loaded for replay: what the drivers said, in order, and the
 * images of the one camera replay serves. Loading checks the whole recording
 * first (`verifyRecording`), so a damaged one fails here, not in the middle of
 * a night.
 */
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { readFitsHeader } from '@cria/fits'
import { readManifest, readRecording, verifyRecording, type Manifest } from '@cria/recording'
import { parseServerElement, type ServerElement } from './xml.js'

export class TapeError extends Error {
  override readonly name = 'TapeError'
}

/** One thing a driver said, with when Cria heard it: `t` on the recording's monotonic clock, `at` in epoch milliseconds. */
export type TapeEvent = { readonly t: number; readonly at: number } & Exclude<ServerElement, { readonly kind: 'image' }>

/** One image the camera delivered, and what its FITS header says about its size. */
export interface Frame {
  readonly index: number
  readonly device: string
  readonly property: string
  readonly element: string
  readonly format: string
  readonly t: number
  readonly at: number
  /** The image file, absolute. */
  readonly path: string
  readonly width: number
  readonly height: number
}

export interface Tape {
  readonly directory: string
  readonly manifest: Manifest
  readonly events: ReadonlyArray<TapeEvent>
  /** The INDI name of the camera whose images replay serves. */
  readonly camera: string
  readonly frames: ReadonlyArray<Frame>
  /** The kind of each INDI device the manifest names. */
  readonly kinds: ReadonlyMap<string, Manifest['devices'][number]['kind']>
}

const mainChip = 'CCD1'
const headerBytes = 64 * 1024

async function frameSize(path: string): Promise<{ width: number; height: number }> {
  const file = await open(path, 'r')

  try {
    const head = Buffer.alloc(headerBytes)
    const { bytesRead } = await file.read(head, 0, headerBytes, 0)
    const { cards } = readFitsHeader(head.subarray(0, bytesRead))
    const width = Number(cards.get('NAXIS1'))
    const height = Number(cards.get('NAXIS2'))

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new TapeError(`${path}: NAXIS1 and NAXIS2 are not a size`)

    return { width, height }
  } finally {
    await file.close()
  }
}

/** Loads the recording in `directory`. `options.camera` names the camera to serve when more than one delivered images. */
export async function loadTape(directory: string, options: { readonly camera?: string } = {}): Promise<Tape> {
  const report = await verifyRecording(directory)

  if (!report.valid) throw new TapeError(`${directory} is not a sound recording: ${JSON.stringify(report.problems.slice(0, 3))}`)

  const manifest = await readManifest(directory)
  const events: TapeEvent[] = []
  const images = new Map<string, Array<{ t: number; at: number; element: string; format: string; path: string }>>()

  for await (const line of readRecording(directory)) {
    if (line.k !== 'msg' || line.dir !== 'in') continue
    const element = parseServerElement(line.xml)

    if (element === undefined) continue

    if (element.kind !== 'image') {
      events.push({ t: line.t, at: line.at, ...element })
      continue
    }

    if (element.name !== mainChip) continue
    for (const image of element.images) {
      if (image.ref === undefined) continue
      const list = images.get(element.device) ?? []

      list.push({ t: line.t, at: line.at, element: image.element, format: image.format, path: join(directory, image.ref) })
      images.set(element.device, list)
    }
  }

  const camera = options.camera ?? [...images.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0]
  const served = camera === undefined ? undefined : images.get(camera)

  if (camera === undefined || served === undefined) throw new TapeError(`${directory} holds no ${mainChip} image${options.camera ? ` from ${options.camera}` : ''}`)

  const frames: Frame[] = []

  for (const image of served) {
    const size = await frameSize(image.path)

    frames.push({ index: frames.length, device: camera, property: mainChip, ...image, ...size })
  }

  return { directory, manifest, events, camera, frames, kinds: new Map(manifest.devices.map(device => [device.indiDevice, device.kind])) }
}
