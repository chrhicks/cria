/**
 * Image boundary: the rolling store. The newest completed frames, oldest
 * dropped first once the total passes the budget, the newest never dropped.
 * No custody, receipts or history: a restart empties the folder.
 *
 * Linux keeps a deleted file readable through a handle that is already open,
 * so a download in progress finishes even if its image is dropped meanwhile;
 * a request after the drop gets 410.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Failed } from '@cria/primitives'
import type { ImageId } from '@cria/wire'
import { mint } from '../ids.js'

export interface StoredImage {
  readonly id: ImageId
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly retainedAt: number
}

export interface ImageStore {
  readonly adopt: (bytes: Buffer) => Effect.Effect<StoredImage, Failed>
  readonly find: (id: ImageId) => Effect.Effect<StoredImage | undefined>
}

const extension = '.imagebytes'

export function makeImageStore(options: { readonly directory: string; readonly budgetBytes: number }): Effect.Effect<ImageStore, Error> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(options.directory, { recursive: true })
        for (const name of await readdir(options.directory)) {
          if (name.endsWith(extension) || name.endsWith('.partial')) await rm(join(options.directory, name), { force: true })
        }
      },
      catch: error => new Error(`Cannot prepare the image directory: ${String(error)}`),
    })

    // Insertion order is age order: the first entry is the oldest.
    const images = new Map<ImageId, StoredImage>()
    let total = 0

    const evict = Effect.promise(async () => {
      for (const image of images.values()) {
        if (total <= options.budgetBytes || images.size <= 1) break
        images.delete(image.id)
        total -= image.bytes
        await rm(image.path, { force: true })
      }
    })

    const adopt = (bytes: Buffer) =>
      Effect.gen(function* () {
        const id = mint.imageId()
        const path = join(options.directory, `${id}${extension}`)
        const partial = join(options.directory, `${randomUUID()}.partial`)

        yield* Effect.tryPromise({
          try: async () => {
            try {
              await writeFile(partial, bytes)
              await rename(partial, path)
            } catch (error) {
              await rm(partial, { force: true })
              throw error
            }
          },
          catch: error => new Failed({ reason: 'unavailable', message: `image-unavailable: ${String(error)}` }),
        })

        const image: StoredImage = {
          id,
          path,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          retainedAt: Date.now(),
        }

        images.set(id, image)
        total += image.bytes
        yield* evict

        return image
      })

    return {
      adopt,
      find: id => Effect.sync(() => images.get(id)),
    }
  })
}
