import { describe, expect, it } from 'vitest'
import type { WireBody } from '../stream/entry.ts'
import { makeReplay } from './replay.ts'

const body = (facts: Partial<WireBody>): WireBody => ({ conn: 1, dir: 'in', n: 1, xml: '', device: 'mount', type: 'set', ...facts })

const track = { indiDevice: 'ZWO AM5', property: 'TRACK' }

describe('replay', () => {
  it('merges the elements of a partial update into the last known values', () => {
    const replay = makeReplay()

    replay.apply(body({ ...track, type: 'def', state: 'Idle', elements: { A: 1, B: 2 } }))

    expect(replay.apply(body({ ...track, elements: { A: 5 } }))?.current).toEqual({ state: 'Idle', elements: { A: 5, B: 2 } })
  })

  it('calls an update a change only when a value or the state differs', () => {
    const replay = makeReplay()

    replay.apply(body({ ...track, type: 'def', state: 'Ok', elements: { A: 1, B: 2 } }))

    expect(replay.apply(body({ ...track, elements: { A: 1 } }))).toMatchObject({ changed: false, known: true })
    expect(replay.apply(body({ ...track, state: 'Ok', elements: { B: 2 } }))).toMatchObject({ changed: false })
    expect(replay.apply(body({ ...track, state: 'Busy' }))).toMatchObject({ changed: true })
    expect(replay.apply(body({ ...track, elements: { B: 3 } }))).toMatchObject({ changed: true })
  })

  it('replaces the elements on a definition', () => {
    const replay = makeReplay()

    replay.apply(body({ ...track, type: 'def', state: 'Ok', elements: { A: 1, B: 2 } }))

    expect(replay.apply(body({ ...track, type: 'def', state: 'Ok', elements: { A: 1 } }))).toMatchObject({ changed: true, current: { elements: { A: 1 } } })
  })

  it('reads the first sight of a property as a change that is not known', () => {
    expect(makeReplay().apply(body({ ...track, state: 'Ok', elements: { A: 1 } }))).toMatchObject({ changed: true, known: false })
  })

  it('forgets a deleted property, or every property of a deleted device', () => {
    const replay = makeReplay()

    replay.apply(body({ ...track, type: 'def', elements: { A: 1 } }))
    replay.apply(body({ indiDevice: 'ZWO AM5', property: 'OTHER', type: 'def', elements: { A: 1 } }))

    expect(replay.apply(body({ ...track, type: 'del' }))).toMatchObject({ changed: true, known: true, current: undefined })
    expect(replay.apply(body({ ...track, type: 'del' }))).toMatchObject({ changed: false })
    expect(replay.apply(body({ indiDevice: 'ZWO AM5', type: 'del' }))).toBeUndefined()
    expect(replay.apply(body({ indiDevice: 'ZWO AM5', property: 'OTHER', elements: { A: 1 } }))).toMatchObject({ known: false })
  })

  it('forgets everything on reset', () => {
    const replay = makeReplay()

    replay.apply(body({ ...track, type: 'def', elements: { A: 1 } }))
    replay.reset()

    expect(replay.apply(body({ ...track, elements: { A: 1 } }))).toMatchObject({ known: false })
  })

  it('leaves out what carries no property', () => {
    const replay = makeReplay()

    expect(replay.apply(body({ type: 'message', indiDevice: 'ZWO AM5', text: 'hi' }))).toBeUndefined()
    expect(replay.apply(body({ type: 'new', ...track, elements: { A: 1 } }))).toBeUndefined()
  })
})
