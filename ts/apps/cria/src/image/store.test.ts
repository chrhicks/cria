import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageId } from '@cria/wire'
import { mint } from '../ids.js'
import { makeImageStore } from './store.js'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cria-store-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

const store = (budgetBytes: number) => Effect.runPromise(makeImageStore({ directory, budgetBytes }))
const files = async () => (await readdir(directory)).sort()

describe('the rolling image store', () => {
  it('empties leftover images and partial writes at start, and leaves other files', async () => {
    await writeFile(join(directory, 'old.imagebytes'), 'x')
    await writeFile(join(directory, 'interrupted.partial'), 'x')
    await writeFile(join(directory, 'notes.txt'), 'x')
    await store(1000)

    expect(await files()).toEqual(['notes.txt'])
  })

  it('keeps an adopted image as one file with its size and digest', async () => {
    const images = await store(1000)
    const image = await Effect.runPromise(images.adopt(Buffer.from('frame')))

    expect(image).toMatchObject({ path: join(directory, `${image.id}.imagebytes`), bytes: 5, sha256: '9dff50df08c635815f4b19da10f756605a34a79a48d4ba48712782502975a70e' })
    expect(await readFile(image.path, 'utf8')).toBe('frame')
    expect(await Effect.runPromise(images.find(image.id))).toEqual(image)
  })

  it('drops the oldest images once the total passes the budget', async () => {
    const images = await store(250)
    const first = await Effect.runPromise(images.adopt(Buffer.alloc(100, 1)))
    const second = await Effect.runPromise(images.adopt(Buffer.alloc(100, 2)))
    const third = await Effect.runPromise(images.adopt(Buffer.alloc(100, 3)))

    expect(await Effect.runPromise(images.find(first.id))).toBe(undefined)
    expect(await Effect.runPromise(images.find(second.id))).toEqual(second)
    expect(await files()).toEqual([`${second.id}.imagebytes`, `${third.id}.imagebytes`].sort())
  })

  it('never drops the newest image, even one larger than the budget', async () => {
    const images = await store(50)
    const first = await Effect.runPromise(images.adopt(Buffer.alloc(100)))

    expect(await files()).toEqual([`${first.id}.imagebytes`])
    const second = await Effect.runPromise(images.adopt(Buffer.alloc(100)))

    expect(await files()).toEqual([`${second.id}.imagebytes`])
  })

  it('removes its partial file when the write cannot complete, and fails unavailable', async () => {
    const images = await store(1000)
    const id = ImageId.make('5e0c1d2a-0000-4000-8000-000000000001')

    vi.spyOn(mint, 'imageId').mockReturnValue(id)
    await mkdir(join(directory, `${id}.imagebytes`, 'occupied'), { recursive: true })
    const failure = await Effect.runPromise(Effect.flip(images.adopt(Buffer.from('frame'))))

    expect([failure._tag, failure.reason, failure.message.startsWith('image-unavailable: Error: EISDIR')]).toEqual(['Failed', 'unavailable', true])
    expect(await files()).toEqual([`${id}.imagebytes`])
    expect(await Effect.runPromise(images.find(id))).toBe(undefined)
  })
})
