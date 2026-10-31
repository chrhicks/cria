import { createHash, randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { Array as Arr, Context, Duration, Effect, FileSystem, Layer, Option, Stream } from 'effect'
import type { Image } from '@cria/wire'
import { Cria, CriaLost, type CriaError } from './cria.js'
import { expired, imageFileName, partFileName, type Entry, type EntryType } from './retention.js'

export interface CachedImage {
  readonly image: Image
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export interface ImageCacheOptions {
  readonly directory: string
  readonly downloadTimeout: Duration.Input
}

export class ImageCache extends Context.Service<ImageCache, {
  /**
   * Puts the frame on disk, checked against `image` and against Cria's headers, and says where.
   * A failure to read or write the directory is a defect: it is this host's, not Cria's.
   */
  readonly fetch: (image: Image) => Effect.Effect<CachedImage, CriaError>
}>()('@cria/mcp/ImageCache') {
  static readonly layer = (options: ImageCacheOptions): Layer.Layer<ImageCache, never, Cria | FileSystem.FileSystem> =>
    Layer.effect(ImageCache)(make(options))
}

const entryType = (stats: Stats): EntryType =>
  stats.isFile() ? 'file' : stats.isSymbolicLink() ? 'symlink' : stats.isDirectory() ? 'directory' : 'other'

/** `lstat` and not `stat`: a symlink must read as a symlink. */
const inspect = (path: string): Effect.Effect<Option.Option<Stats>, NodeJS.ErrnoException> =>
  Effect.matchEffect(Effect.tryPromise({ try: () => lstat(path), catch: error => error as NodeJS.ErrnoException }), {
    onSuccess: stats => Effect.succeed(Option.some(stats)),
    onFailure: error => (error.code === 'ENOENT' ? Effect.succeedNone : Effect.fail(error)),
  })

/** A step whose failure costs this call nothing: it is logged and the call goes on. */
const bestEffort = <E extends { readonly message: string }, R>(what: string, effect: Effect.Effect<void, E, R>) =>
  Effect.matchEffect(effect, { onSuccess: () => Effect.void, onFailure: error => Effect.logWarning(`${what}: ${error.message}`) })

const make = Effect.fnUntraced(function* ({ directory, downloadTimeout }: ImageCacheOptions) {
  const cria = yield* Cria
  const fs = yield* FileSystem.FileSystem

  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(Effect.orDie)

  const prune = bestEffort(
    'could not prune the image directory',
    Effect.gen(function* () {
      const now = yield* Effect.clockWith(clock => clock.currentTimeMillis)
      const names = yield* fs.readDirectory(directory)
      const entries = yield* Effect.forEach(names, name =>
        Effect.map(inspect(join(directory, name)), Option.map((stats): Entry => ({ name, type: entryType(stats), modifiedAt: stats.mtimeMs }))),
      )

      yield* Effect.forEach(expired(now, Arr.getSomes(entries)), name => fs.remove(join(directory, name), { force: true }), { discard: true })
    }),
  )

  const sha256Of = (path: string) =>
    Effect.suspend(() => {
      const hash = createHash('sha256')

      return fs.stream(path).pipe(Stream.runForEach(chunk => Effect.sync(() => void hash.update(chunk))), Effect.map(() => hash.digest('hex')))
    }).pipe(Effect.orDie)

  /** A finished download of this image that still has the size and sha256 the image names. */
  const kept = (image: Image, path: string) =>
    Effect.gen(function* () {
      const stats = yield* Effect.orDie(inspect(path))

      if (Option.isNone(stats) || !stats.value.isFile() || stats.value.size !== image.original.bytes) return false

      return (yield* sha256Of(path)) === image.sha256
    })

  const download = (image: Image, path: string) => {
    const lost = (why: CriaLost['why'], message: string) => new CriaLost({ route: `GET /v2/images/${image.id}/original`, why, message })
    const part = join(directory, partFileName(image.id, randomUUID()))

    return Effect.gen(function* () {
      const original = yield* cria.original(image.id)
      const expected = image.original.bytes

      if (!Option.contains(original.contentLength, expected))
        return yield* Effect.fail(lost('not-protocol-5', `content-length is ${Option.getOrElse(original.contentLength, () => 'missing')}, the image says ${expected} bytes`))
      if (!Option.contains(original.etag, `"${image.sha256}"`))
        return yield* Effect.fail(lost('not-protocol-5', 'etag is not the sha256 the image names'))

      const hash = createHash('sha256')
      let received = 0

      yield* original.body.pipe(
        Stream.tap(chunk => {
          received += chunk.length
          if (received > expected) return Effect.fail(lost('not-protocol-5', `more than the ${expected} bytes the image names`))
          hash.update(chunk)

          return Effect.void
        }),
        Stream.run(fs.sink(part, { flag: 'wx', mode: 0o600 })),
        Effect.catchTag('PlatformError', Effect.die),
      )

      if (received !== expected) return yield* Effect.fail(lost('transport', `the body ended after ${received} of ${expected} bytes`))
      if (hash.digest('hex') !== image.sha256) return yield* Effect.fail(lost('not-protocol-5', 'the body is not the sha256 the image names'))

      yield* fs.rename(part, path).pipe(Effect.orDie)

      return { image, path, sha256: image.sha256, bytes: received }
    }).pipe(
      Effect.scoped,
      Effect.onError(() => bestEffort('could not remove an unfinished download', fs.remove(part, { force: true }))),
      Effect.timeoutOrElse({
        duration: downloadTimeout,
        orElse: () => Effect.fail(lost('timeout', `the download did not finish within ${Duration.format(Duration.fromInputUnsafe(downloadTimeout))}`)),
      }),
    )
  }

  const fetch = Effect.fnUntraced(function* (image: Image) {
    yield* prune

    const path = join(directory, imageFileName(image.id))

    if (yield* kept(image, path)) return { image, path, sha256: image.sha256, bytes: image.original.bytes }

    return yield* download(image, path)
  })

  return ImageCache.of({ fetch })
})
