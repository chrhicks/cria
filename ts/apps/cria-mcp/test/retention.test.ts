import { describe, expect, it } from '@effect/vitest'
import { expired, type Entry } from '../src/retention.js'

const day = 24 * 60 * 60 * 1000
const now = 1_793_361_600_000
const id = '3a1d5c9e-2f4b-4e86-9a0c-7d8e6f5a4b32'
const nonce = '9b7c3d2e-1f0a-4c5b-8d6e-5a4f3e2d1c0b'
const entry = (name: string, ageDays: number, type: Entry['type'] = 'file'): Entry => ({ name, type, modifiedAt: now - ageDays * day })

describe('the retention rule', () => {
  it('keeps seven days', () => {
    expect(expired(now, [entry(`${id}.imagebytes`, 7)])).toEqual([])
    expect(expired(now, [entry(`${id}.imagebytes`, 7 + 1 / 86_400)])).toEqual([`${id}.imagebytes`])
  })

  it('names finished downloads and part files, in either case', () => {
    const names = [`${id}.imagebytes`, `${id}.${nonce}.part`, `${id.toUpperCase()}.imagebytes`]

    expect(expired(now, names.map(name => entry(name, 30)))).toEqual(names)
  })

  it.each([
    ['a note', 'notes.txt'],
    ['an image id that is not a UUID', 'frame.imagebytes'],
    ['a longer extension', `${id}.imagebytes.bak`],
    ['another extension', `${id}.fits`],
    ['a part file without a nonce', `${id}.part`],
    ['a part file with a nonce that is not a UUID', `${id}.abc.part`],
    ['a path', `../${id}.imagebytes`],
    ['a nested path', `sub/${id}.imagebytes`],
    ['a prefix', `x${id}.imagebytes`],
  ])('never names %s', (_, name) => {
    expect(expired(now, [entry(name, 365)])).toEqual([])
  })

  it.each(['symlink', 'directory', 'other'] as const)('never names a file of type %s, however old', type => {
    expect(expired(now, [entry(`${id}.imagebytes`, 365, type)])).toEqual([])
  })

  it('keeps a file modified in the future', () => {
    expect(expired(now, [entry(`${id}.imagebytes`, -1)])).toEqual([])
  })
})
