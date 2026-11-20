import { describe, expect, it } from 'vitest'
import type { Astap } from './astap.ts'
import { createMeasure, type MeasureAnswer, type MeasureDependencies } from './measure.ts'

const header = new Map<string, string | number>([
  ['DATE-OBS', '2026-11-08T03:30:00.000'],
  ['EXPTIME', 2],
  ['FOCALLEN', 400],
  ['NAXIS2', 4176],
  ['XPIXSZ', 3.76],
  ['SITELAT', 33.45],
])

const solved: Astap = {
  solve: async () => ({ solved: true, raDegrees: 340.5, decDegrees: 79.6, wcs: { CRVAL1: 340.5, CRVAL2: 79.6, CROTA2: -69.3 } }),
  stars: async () => ({ measured: true, hfd: 3.2, count: 488 }),
}

function setup(overrides: Partial<MeasureDependencies> = {}, present: ReadonlyArray<string> = ['/spool/measure/polar-align_light_013.fits']) {
  const events: string[] = []
  const stored: MeasureAnswer[] = []
  const answered: MeasureAnswer[] = []
  let clock = 1000

  const measure = createMeasure({
    folder: '/spool/measure',
    keepFolder: '/spool/frames',
    astap: solved,
    readHeader: async () => header,
    store: async answer => {
      events.push('store')
      stored.push(answer)
    },
    answer: answer => void answered.push(answer),
    remove: async path => void events.push(`remove ${path}`),
    move: async (from, to) => void events.push(`move ${from} ${to}`),
    exists: async path => present.includes(path),
    now: () => (clock += 390),
    log: () => {},
    ...overrides,
  })

  return { measure, events, stored, answered }
}

const request = (fields: Record<string, unknown> = {}) => JSON.stringify({ id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', measure: ['solve'], remove: true, ...fields })

describe('measuring a frame on the rig computer', () => {
  it('solves, stores the result with the header, and only then removes the frame', async () => {
    const { measure, events, stored } = setup()

    await measure.receive(request())

    expect(events).toEqual(['store', 'remove /spool/measure/polar-align_light_013.fits'])
    expect(stored).toEqual([
      {
        id: 'vela-1',
        by: 'vela',
        file: 'polar-align_light_013.fits',
        result: 'measured',
        seconds: 0.39,
        solve: { solved: true, raDegrees: 340.5, decDegrees: 79.6, wcs: { CRVAL1: 340.5, CRVAL2: 79.6, CROTA2: -69.3 } },
        header: { 'DATE-OBS': '2026-11-08T03:30:00.000', EXPTIME: 2, FOCALLEN: 400, NAXIS2: 4176, XPIXSZ: 3.76 },
        remove: 'after this entry',
      },
    ])
  })

  it('leaves site cards out of the header it publishes', async () => {
    const { measure, stored } = setup()

    await measure.receive(request())

    expect(stored[0]).toMatchObject({ result: 'measured' })
    expect(JSON.stringify(stored[0])).not.toContain('SITELAT')
  })

  it('measures stars for focus and keeps the frame when asked to', async () => {
    const { measure, events, stored } = setup()

    await measure.receive(request({ measure: ['stars'], remove: false }))

    expect(events).toEqual(['store'])
    expect(stored[0]).toMatchObject({ stars: { measured: true, hfd: 3.2, count: 488 }, remove: 'kept' })
    expect(stored[0]).not.toHaveProperty('solve')
  })

  it('stores a frame that does not solve as measured, with the reason', async () => {
    const { measure, stored, events } = setup({ astap: { ...solved, solve: async () => ({ solved: false, reason: 'no solution' }) } })

    await measure.receive(request())

    expect(stored[0]).toMatchObject({ result: 'measured', solve: { solved: false, reason: 'no solution' } })
    expect(events).toHaveLength(2)
  })

  it('does not remove the frame when the result could not be stored', async () => {
    const { measure, events } = setup({
      store: async () => {
        throw new Error('broker gone')
      },
    })

    await measure.receive(request())

    expect(events).toEqual([])
  })

  it('says so when the frame could not be removed', async () => {
    const { measure, answered } = setup({
      remove: async () => {
        throw new Error('EACCES')
      },
    })

    await measure.receive(request())

    expect(answered).toEqual([{ id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', result: 'not removed', reason: 'EACCES' }])
  })

  it('moves the frame and its sidecar into the spool after the answer is stored when asked to keep it', async () => {
    const { measure, events, stored } = setup({}, ['/spool/measure/polar-align_light_013.fits', '/spool/measure/polar-align_light_013.fits.json'])

    await measure.receive(request({ keep: true }))

    expect(events).toEqual([
      'store',
      'move /spool/measure/polar-align_light_013.fits /spool/frames/polar-align_light_013.fits',
      'move /spool/measure/polar-align_light_013.fits.json /spool/frames/polar-align_light_013.fits.json',
    ])
    expect(stored[0]).toMatchObject({ result: 'measured', remove: 'moved to the spool' })
  })

  it('moves only the frame when the capture wrote no sidecar', async () => {
    const { measure, events } = setup()

    await measure.receive(request({ keep: true }))

    expect(events).toEqual(['store', 'move /spool/measure/polar-align_light_013.fits /spool/frames/polar-align_light_013.fits'])
  })

  it('removes the frame as before when keep is false', async () => {
    const { measure, events } = setup({}, ['/spool/measure/polar-align_light_013.fits', '/spool/measure/polar-align_light_013.fits.json'])

    await measure.receive(request({ keep: false }))

    expect(events).toEqual(['store', 'remove /spool/measure/polar-align_light_013.fits'])
  })

  it('leaves the frame in place and says so when it could not be moved', async () => {
    const { measure, events, answered } = setup({
      move: async () => {
        throw new Error('EXDEV')
      },
    })

    await measure.receive(request({ keep: true }))

    expect(events).toEqual(['store'])
    expect(answered).toEqual([{ id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', result: 'not kept', reason: 'EXDEV' }])
  })

  it('does not overwrite a frame of the same name already in the spool', async () => {
    const { measure, events, answered } = setup({}, ['/spool/measure/polar-align_light_013.fits', '/spool/frames/polar-align_light_013.fits'])

    await measure.receive(request({ keep: true }))

    expect(events).toEqual(['store'])
    expect(answered[0]).toMatchObject({ result: 'not kept' })
  })

  it('refuses a request to keep when no spool folder is set up', async () => {
    const { measure, events, answered } = setup({ keepFolder: undefined })

    await measure.receive(request({ keep: true }))

    expect(events).toEqual([])
    expect(answered).toEqual([{ id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', result: 'refused', reason: 'keeping a frame is not set up in the rig file' }])
  })

  it('refuses a name that is not a plain frame in the measure folder', async () => {
    const { measure, answered, stored } = setup()

    for (const file of ['../rig.json', 'sub/frame.fits', '.hidden.fits', 'polar-align_light_099.fits']) await measure.receive(request({ file }))

    expect(stored).toEqual([])
    expect(answered.map(answer => answer.result)).toEqual(['refused', 'refused', 'refused', 'refused'])
    expect(answered[3]).toMatchObject({ reason: 'polar-align_light_099.fits is not in the measure folder' })
  })

  it('refuses a request that is not a measure request, and when measuring is not set up', async () => {
    const { measure, answered } = setup()
    const off = setup({ folder: undefined, astap: undefined })

    await measure.receive(JSON.stringify({ id: 'x', by: 'vela', file: 'a.fits', measure: [], remove: true }))
    await off.measure.receive(request())

    expect(answered[0]).toMatchObject({ id: 'x', result: 'refused' })
    expect(off.answered[0]).toMatchObject({ result: 'refused', reason: 'measure is not set up in the rig file' })
  })

  it('measures one frame at a time, in the order asked', async () => {
    const order: string[] = []
    const { measure } = setup({
      exists: async () => true,
      astap: {
        ...solved,
        solve: async path => {
          order.push(`start ${path}`)
          await new Promise(resolve => setTimeout(resolve, path.endsWith('1.fits') ? 20 : 1))
          order.push(`end ${path}`)
          return { solved: false, reason: 'no solution' }
        },
      },
    })

    await Promise.all([measure.receive(request({ file: 'a_1.fits' })), measure.receive(request({ file: 'a_2.fits' }))])

    expect(order).toEqual(['start /spool/measure/a_1.fits', 'end /spool/measure/a_1.fits', 'start /spool/measure/a_2.fits', 'end /spool/measure/a_2.fits'])
  })
})
