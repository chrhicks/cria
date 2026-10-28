import { describe, expect, it } from 'vitest'
import { planFrames, type Capture, type Delivery, type Evidence, type VelaFrame } from './plan.js'

const capture = (n: number, over: Partial<Capture> = {}): Capture => ({
  operationId: `op-${n}`,
  imageId: `img-${n}`,
  device: 'Camera',
  startedAt: 1000 * n,
  settledAt: 1000 * n + 900,
  capturedAt: 1000 * n + 5,
  capturedAtSource: 'camera',
  exposureSeconds: 2,
  ...over,
})

const delivery = (n: number, over: Partial<Delivery> = {}): Delivery => ({ path: `blobs/1-${n}-0.blob`, device: 'Camera', at: 1000 * n + 800, ...over })

const frame = (n: number, over: Partial<VelaFrame> = {}): VelaFrame => ({ velaImageId: `vela-${n}`, outcome: 'saved', imageId: `img-${n}`, operationId: `op-${n}`, capturedAt: 1000 * n + 5, exposureSeconds: 2, ...over })

const evidence = (n: number, over: Partial<Evidence> = {}): Evidence => ({
  captures: Array.from({ length: n }, (_, k) => capture(k + 1)),
  deliveries: Array.from({ length: n }, (_, k) => delivery(k + 1)),
  blobFiles: Array.from({ length: n }, (_, k) => `blobs/1-${k + 1}-0.blob`),
  velaFrames: [],
  samples: [],
  window: { from: 0, to: 100_000 },
  ...over,
})

const kept = (plan: ReturnType<typeof planFrames>) => plan.keep.map(entry => entry.path)

describe('planFrames', () => {
  it('keeps a saved frame by image id and prunes the rest with the reason that fits', () => {
    const plan = planFrames(evidence(3, { velaFrames: [frame(1), frame(2, { outcome: 'unsaved' })] }))

    expect(kept(plan)).toEqual(['blobs/1-1-0.blob'])
    expect(plan.prune).toEqual([
      { path: 'blobs/1-2-0.blob', reason: 'not saved by Vela' },
      { path: 'blobs/1-3-0.blob', reason: 'no Vela record of this capture' },
    ])
    expect(plan.unmatched).toEqual([])
  })

  it('keeps a frame whose save failed: the recording holds the only copy', () => {
    expect(kept(planFrames(evidence(2, { velaFrames: [frame(1, { outcome: 'save-failed' }), frame(2, { outcome: 'lost' })] })))).toEqual(['blobs/1-1-0.blob'])
  })

  it('keeps every autofocus sample by its capture time and says why', () => {
    const plan = planFrames(evidence(3, { velaFrames: [frame(1)], samples: [{ capturedAt: 2005 }, { capturedAt: 3005 }] }))

    expect(plan.keep.map(entry => [entry.path, entry.why])).toEqual([
      ['blobs/1-1-0.blob', ['saved by Vela: vela-1']],
      ['blobs/1-2-0.blob', ['autofocus sample']],
      ['blobs/1-3-0.blob', ['autofocus sample']],
    ])
  })

  it('matches a record with no image id by capture time and exposure, and counts it', () => {
    const plan = planFrames(evidence(2, { velaFrames: [frame(2, { imageId: null, operationId: null })] }))

    expect(kept(plan)).toEqual(['blobs/1-2-0.blob'])
    expect(plan.matchedByTime).toBe(1)
  })

  it('reports a record whose image id is in this session but whose operation id differs', () => {
    const plan = planFrames(evidence(1, { velaFrames: [frame(1, { operationId: 'someone-else' })] }))

    expect(plan.unmatched).toEqual([{ source: 'frame-record', id: 'vela-1', reason: 'operation-mismatch' }])
    expect(plan.prune.map(entry => entry.path)).toEqual(['blobs/1-1-0.blob'])
  })

  it('reports a saved record inside the session that no recorded image answers, and ignores one outside it', () => {
    const plan = planFrames(evidence(1, { velaFrames: [frame(1), frame(50, { capturedAt: 50_005 }), frame(900, { capturedAt: 900_000 })] }))

    expect(plan.unmatched).toEqual([{ source: 'frame-record', id: 'vela-50', reason: 'image-not-in-recording' }])
  })

  it('reports an autofocus sample inside the session with no image at that time', () => {
    const plan = planFrames(evidence(1, { velaFrames: [frame(1)], samples: [{ capturedAt: 42_000 }, { capturedAt: 900_000 }] }))

    expect(plan.unmatched).toEqual([{ source: 'autofocus', id: '42000', reason: 'no-capture-at-that-time' }])
  })

  it('reports a wanted capture whose image file is not in its window', () => {
    const plan = planFrames(evidence(2, { velaFrames: [frame(1)], deliveries: [delivery(2)] }))

    expect(plan.unmatched).toEqual([{ source: 'frame-record', id: 'vela-1', reason: 'no-image-file' }])
  })

  it('uses the FITS header to pick among several images in one window, and reports when it cannot', () => {
    const stray = delivery(1, { path: 'blobs/1-0-0.blob', at: 1500, exposureSeconds: 30 })
    const own = delivery(1, { exposureSeconds: 2, observedAt: 1000 })
    const files = ['blobs/1-0-0.blob', 'blobs/1-1-0.blob']

    expect(kept(planFrames(evidence(1, { velaFrames: [frame(1)], deliveries: [stray, own], blobFiles: files })))).toEqual(['blobs/1-1-0.blob'])
    expect(planFrames(evidence(1, { velaFrames: [frame(1)], deliveries: [delivery(1, { path: 'blobs/1-0-0.blob', at: 1500 }), delivery(1)], blobFiles: files })).unmatched).toEqual([
      { source: 'frame-record', id: 'vela-1', reason: 'several-image-files' },
    ])
  })

  it('does not match an image from another camera in the window', () => {
    const plan = planFrames(evidence(1, { velaFrames: [frame(1)], deliveries: [delivery(1, { device: 'Guide' })] }))

    expect(plan.unmatched).toEqual([{ source: 'frame-record', id: 'vela-1', reason: 'no-image-file' }])
  })

  it('refuses to give one file to two captures', () => {
    const plan = planFrames(evidence(2, { velaFrames: [frame(1), frame(2)], captures: [capture(1, { settledAt: 2900 }), capture(2)], deliveries: [delivery(2)], blobFiles: ['blobs/1-2-0.blob'] }))

    expect(plan.unmatched.map(entry => entry.reason)).toEqual(['image-file-claimed-twice', 'image-file-claimed-twice'])
    expect(kept(plan)).toEqual([])
  })

  it('reports a session with captures and no Vela record at all, instead of pruning every frame', () => {
    expect(planFrames(evidence(2)).unmatched).toEqual([{ source: 'session', id: '', reason: 'no-vela-records' }])
    expect(planFrames(evidence(0)).unmatched).toEqual([])
  })

  it('prunes a file no line names and an image no capture delivered', () => {
    const plan = planFrames(evidence(1, { velaFrames: [frame(1)], deliveries: [delivery(1), delivery(7, { at: 7_000 })], blobFiles: ['blobs/1-1-0.blob', 'blobs/1-7-0.blob', 'blobs/1-9-0.blob.partial'] }))

    expect(plan.prune).toEqual([
      { path: 'blobs/1-7-0.blob', reason: 'no capture operation delivered this image' },
      { path: 'blobs/1-9-0.blob.partial', reason: 'not named by traffic.jsonl' },
    ])
  })
})
