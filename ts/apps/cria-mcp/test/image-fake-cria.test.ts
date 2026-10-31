import { randomUUID } from 'node:crypto'
import { lstat, lutimes, mkdir, readdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { callTool, callToolRaw, json, startFakeCria, startMcp, scratchDirectory, type FakeHandler } from './support.js'
import { imageId, imageOf, sha256Of } from './fixtures.js'

const frame = Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 31) % 251))
const original = `/v2/images/${imageId}/original`

const imagebytes = (bytes: Uint8Array, headers: Record<string, string> = {}): FakeHandler => (_, response) => {
  response.writeHead(200, { 'content-type': 'application/imagebytes', 'content-length': String(bytes.length), etag: `"${sha256Of(bytes)}"`, ...headers })
  response.end(bytes)
}

const against = (handler: FakeHandler, env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const cria = yield* startFakeCria(handler)
    const mcp = yield* startMcp({ CRIA_URL: cria.origin, CRIA_REPLY_TIMEOUT: '2 seconds', ...env })

    return { cria, mcp }
  })

const files = (directory: string) => Effect.promise(() => readdir(directory))
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

describe('image against a fake Cria', () => {
  it.live('downloads the frame, checks it, and returns the image, the path, the sha256 and the size', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(imagebytes(frame))
      const image = imageOf(frame)
      const result = yield* callTool(mcp.url, 'image', { image })
      const path = join(mcp.imageDirectory, `${imageId}.imagebytes`)

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ kind: 'answered', body: { image, path, sha256: sha256Of(frame), bytes: frame.length } })
      expect(Buffer.compare(yield* Effect.promise(() => readFile(path)), frame)).toBe(0)
      expect(yield* files(mcp.imageDirectory)).toEqual([`${imageId}.imagebytes`])
      expect(cria.requests.map(request => `${request.method} ${request.url}`)).toEqual([`GET ${original}`])
      expect(cria.requests[0]!.headers.origin).toBeUndefined()
    }),
  )

  it.live('builds the route from image.id and never follows original.url', () =>
    Effect.gen(function* () {
      const elsewhere = yield* startFakeCria(imagebytes(frame))
      const { cria, mcp } = yield* against(imagebytes(frame))
      const image = { ...imageOf(frame), original: { ...imageOf(frame).original, url: `${elsewhere.origin}/take-this` } }
      const result = yield* callTool(mcp.url, 'image', { image })

      expect(result.structuredContent.kind).toBe('answered')
      expect(elsewhere.requests).toEqual([])
      expect(cria.requests.map(request => request.url)).toEqual([original])
    }),
  )

  it.live('sends the bearer token when one is set', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(imagebytes(frame), { CRIA_TOKEN: 'a-test-token' })
      const result = yield* callTool(mcp.url, 'image', { image: imageOf(frame) })

      expect(cria.requests[0]!.headers.authorization).toBe('Bearer a-test-token')
      expect(JSON.stringify(result)).not.toContain('a-test-token')
    }),
  )

  it.live("passes Cria's refusal through unchanged and leaves nothing behind", () =>
    Effect.gen(function* () {
      const refusal = { error: { code: 'image-gone', message: 'This image is no longer kept' }, instanceId: null }
      const { mcp } = yield* against((_, response) => json(response, 410, refusal))
      const result = yield* callTool(mcp.url, 'image', { image: imageOf(frame) })

      expect(result.structuredContent).toEqual({ kind: 'refused', status: 410, body: refusal })
      expect(yield* files(mcp.imageDirectory)).toEqual([])
    }),
  )

  describe('a frame that does not match the image, and leaves no file behind', () => {
    const lostWith = (why: string, ...fragments: string[]) => (result: { structuredContent?: any }) => {
      expect(result.structuredContent).toMatchObject({ kind: 'lost', route: `GET ${original}`, why })
      for (const fragment of fragments) expect(result.structuredContent.message).toContain(fragment)
    }

    const refused = (name: string, handler: FakeHandler, check: (result: { structuredContent?: any }) => void, env: Record<string, string> = {}, image = imageOf(frame)) =>
      it.live(name, () =>
        Effect.gen(function* () {
          const { mcp } = yield* against(handler, env)

          check(yield* callTool(mcp.url, 'image', { image }))
          expect(yield* files(mcp.imageDirectory)).toEqual([])
        }),
      )

    const corrupt = Buffer.from(frame)

    corrupt[100] = corrupt[100]! ^ 0xff

    refused('sha256 mismatch: the right size and the wrong bytes', imagebytes(corrupt, { etag: `"${sha256Of(frame)}"` }), lostWith('not-protocol-5', 'sha256'))
    refused('etag is not the image sha256', imagebytes(frame, { etag: `"${sha256Of(corrupt)}"` }), lostWith('not-protocol-5', 'etag'))
    refused('content-length is not the image size', imagebytes(frame.subarray(0, 4000)), lostWith('not-protocol-5', 'content-length'))
    refused('no etag at all', (_, response) => void response.writeHead(200, { 'content-type': 'application/imagebytes', 'content-length': String(frame.length) }).end(frame), lostWith('not-protocol-5', 'etag'))
    refused('media type is not imagebytes', imagebytes(frame, { 'content-type': 'text/html' }), lostWith('not-protocol-5'))
    refused(
      'short body: the connection drops before content-length',
      (_, response) => {
        response.writeHead(200, { 'content-type': 'application/imagebytes', 'content-length': String(frame.length), etag: `"${sha256Of(frame)}"` })
        response.write(frame.subarray(0, 1000))
        setTimeout(() => response.destroy(), 50)
      },
      lostWith('transport'),
    )
    refused(
      'stall: the body stops past CRIA_MCP_DOWNLOAD_TIMEOUT',
      (_, response) => {
        response.writeHead(200, { 'content-type': 'application/imagebytes', 'content-length': String(frame.length), etag: `"${sha256Of(frame)}"` })
        response.write(frame.subarray(0, 1000))
      },
      lostWith('timeout'),
      { CRIA_MCP_DOWNLOAD_TIMEOUT: '600 millis' },
    )
  })

  it.live('does not hold the download to the reply timeout', () =>
    Effect.gen(function* () {
      const slow: FakeHandler = (_, response) => {
        response.writeHead(200, { 'content-type': 'application/imagebytes', 'content-length': String(frame.length), etag: `"${sha256Of(frame)}"` })
        response.write(frame.subarray(0, 1000))
        setTimeout(() => response.end(frame.subarray(1000)), 1200)
      }
      const { mcp } = yield* against(slow, { CRIA_REPLY_TIMEOUT: '500 millis', CRIA_MCP_DOWNLOAD_TIMEOUT: '10 seconds' })
      const result = yield* callTool(mcp.url, 'image', { image: imageOf(frame) })

      expect(result.structuredContent.kind).toBe('answered')
    }),
  )

  it.live('returns a kept file whose size and sha256 match, without a request to Cria', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(imagebytes(frame))
      const image = imageOf(frame)

      yield* callTool(mcp.url, 'image', { image })
      const second = yield* callTool(mcp.url, 'image', { image })

      expect(second.structuredContent).toEqual({ kind: 'answered', body: { image, path: join(mcp.imageDirectory, `${imageId}.imagebytes`), sha256: sha256Of(frame), bytes: frame.length } })
      expect(cria.requests).toHaveLength(1)
      expect(yield* files(mcp.imageDirectory)).toEqual([`${imageId}.imagebytes`])
    }),
  )

  it.live('replaces a kept file that has the right size and the wrong bytes', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(imagebytes(frame))
      const path = join(mcp.imageDirectory, `${imageId}.imagebytes`)

      yield* Effect.promise(async () => {
        await mkdir(mcp.imageDirectory, { recursive: true })
        await writeFile(path, Buffer.alloc(frame.length, 7))
      })
      const result = yield* callTool(mcp.url, 'image', { image: imageOf(frame) })

      expect(result.structuredContent.kind).toBe('answered')
      expect(Buffer.compare(yield* Effect.promise(() => readFile(path)), frame)).toBe(0)
      expect(cria.requests).toHaveLength(1)
      expect(yield* files(mcp.imageDirectory)).toEqual([`${imageId}.imagebytes`])
    }),
  )

  it.live('refuses an image that is not the wire Image as input, before it reaches Cria', () =>
    Effect.gen(function* () {
      const { cria, mcp } = yield* against(imagebytes(frame))
      const { sha256: _, ...missing } = imageOf(frame)

      for (const image of [missing, { ...imageOf(frame), id: '../../etc/passwd' }]) {
        const message = yield* callToolRaw(mcp.url, 'image', { image })

        expect(message?.error ?? message?.result?.isError).toBeTruthy()
      }
      expect(cria.requests).toEqual([])
    }),
  )

  it.live('refuses to start when the image directory is not absolute', () =>
    Effect.gen(function* () {
      const failure = yield* startMcp({ CRIA_URL: 'http://127.0.0.1:9', CRIA_MCP_IMAGE_DIR: 'images' }).pipe(Effect.flip)

      expect(failure.message).toContain('absolute')
    }),
  )
})

describe('pruning, on every image call', () => {
  it.live('deletes only matching regular files older than seven days, and leaves everything else', () =>
    Effect.gen(function* () {
      const root = yield* scratchDirectory('cria-mcp-prune-')
      const directory = join(root, 'images')
      const outside = join(root, 'outside.txt')
      const [oldImage, oldPart, youngImage, youngPart, oldOther, oldBackup, oldDirectory, oldLink, uppercase] = Array.from({ length: 9 }, () => randomUUID())
      const names = {
        oldImage: `${oldImage}.imagebytes`,
        oldPart: `${oldImage}.${oldPart}.part`,
        youngImage: `${youngImage}.imagebytes`,
        youngPart: `${youngImage}.${youngPart}.part`,
        oldOther: `${oldOther}.fits`,
        oldBackup: `${oldBackup}.imagebytes.bak`,
        oldDirectory: `${oldDirectory}.imagebytes`,
        oldLink: `${oldLink}.imagebytes`,
        notes: 'notes.txt',
        uppercase: `${uppercase!.toUpperCase()}.imagebytes`,
      }

      yield* Effect.promise(async () => {
        await mkdir(join(directory, names.oldDirectory), { recursive: true })
        await writeFile(outside, 'not ours')
        await utimes(outside, daysAgo(30), daysAgo(30))
        await symlink(outside, join(directory, names.oldLink))
        await lutimes(join(directory, names.oldLink), daysAgo(30), daysAgo(30))
        for (const name of [names.oldImage, names.oldPart, names.youngImage, names.youngPart, names.oldOther, names.oldBackup, names.notes, names.uppercase])
          await writeFile(join(directory, name), name)
        for (const [name, age] of [
          [names.oldImage, 8],
          [names.oldPart, 8],
          [names.youngImage, 6.5],
          [names.youngPart, 6.5],
          [names.oldOther, 30],
          [names.oldBackup, 30],
          [names.oldDirectory, 30],
          [names.notes, 365],
          [names.uppercase, 8],
        ] as const)
          await utimes(join(directory, name), daysAgo(age), daysAgo(age))
      })

      const frame = Buffer.from('pruning frame')
      const { mcp } = yield* Effect.gen(function* () {
        const cria = yield* startFakeCria(imagebytes(frame))

        return { mcp: yield* startMcp({ CRIA_URL: cria.origin, CRIA_MCP_IMAGE_DIR: directory }) }
      })
      const result = yield* callTool(mcp.url, 'image', { image: imageOf(frame) })

      expect(result.structuredContent.kind).toBe('answered')
      expect((yield* files(directory)).sort()).toEqual(
        [names.youngImage, names.youngPart, names.oldOther, names.oldBackup, names.oldDirectory, names.oldLink, names.notes, `${imageId}.imagebytes`].sort(),
      )
      expect((yield* Effect.promise(() => lstat(join(directory, names.oldLink)))).isSymbolicLink()).toBe(true)
      expect(yield* Effect.promise(() => readFile(outside, 'utf8'))).toBe('not ours')
      expect((yield* Effect.promise(() => lstat(join(directory, names.oldDirectory)))).isDirectory()).toBe(true)
    }),
  )

  it.live('prunes before it returns a kept file, so a seven day old frame is fetched again', () =>
    Effect.gen(function* () {
      const root = yield* scratchDirectory('cria-mcp-prune-')
      const directory = join(root, 'images')
      const path = join(directory, `${imageId}.imagebytes`)
      const cria = yield* startFakeCria(imagebytes(frame))
      const mcp = yield* startMcp({ CRIA_URL: cria.origin, CRIA_MCP_IMAGE_DIR: directory })

      yield* callTool(mcp.url, 'image', { image: imageOf(frame) })
      yield* Effect.promise(() => utimes(path, daysAgo(8), daysAgo(8)))
      yield* callTool(mcp.url, 'image', { image: imageOf(frame) })

      expect(cria.requests).toHaveLength(2)
      expect(Date.now() - (yield* Effect.promise(() => lstat(path))).mtimeMs).toBeLessThan(60_000)
    }),
  )
})
