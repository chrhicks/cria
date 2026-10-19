import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fitsToImageBytes } from '@cria/fits'
import { starCapacity, synthesizeTape, type SynthSpec } from './synthesize.js'
import { loadTape } from './tape.js'

const sensor = { width: 160, height: 128 }

const spec: SynthSpec = {
  sensor,
  exposureSeconds: 1,
  stars: [0, 1, 6, 12],
  site: { latitudeDegrees: 10, longitudeDegrees: 20 },
  startAt: Date.UTC(2030, 0, 1),
  pointing: { raHours: 3, decDegrees: 20 },
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'synthesize-'))
})

afterEach(() => rm(directory, { recursive: true, force: true }))

describe('the stars of a synthetic frame', () => {
  it('hold as many separate peaks as the frame was asked for, 12 at most on a 160x128 sensor', async () => {
    const tape = await loadTape(await synthesizeTape(spec, join(directory, 'tape')))
    const peaks = async (path: string) => {
      const { bytes } = fitsToImageBytes(await readFile(path), sensor)

      return Array.from({ length: sensor.width * sensor.height }, (_, pixel) => bytes.readUInt16LE(44 + pixel * 2)).filter(value => value >= 20000).length
    }

    expect(starCapacity(sensor)).toBe(12)
    expect(await Promise.all(tape.frames.map(frame => peaks(frame.path)))).toEqual([0, 1, 6, 12])
  })

  it('refuses more stars than the sensor holds, naming both', async () => {
    await expect(synthesizeTape({ ...spec, stars: [13] }, join(directory, 'tape'))).rejects.toThrow('Frame 0 asks for 13 stars; a 160x128 sensor holds 12')
  })
})

describe('the mount of a synthetic recording', () => {
  it('reports no pier side unless asked, and the side it was asked for otherwise', async () => {
    const sides = async (pierSide?: 'east' | 'west') => {
      const tape = await loadTape(await synthesizeTape({ ...spec, ...(pierSide ? { pierSide } : {}) }, join(directory, `tape-${pierSide ?? 'none'}`)))

      return tape.events.filter(event => event.kind === 'define' && event.vector.name === 'TELESCOPE_PIER_SIDE').map(event => (event.kind === 'define' ? event.vector.elements : null))
    }

    expect(await sides()).toEqual([])
    expect(await sides('west')).toMatchObject([{ PIER_EAST: { value: false }, PIER_WEST: { value: true } }])
  })
})
