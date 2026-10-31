import { Duration } from 'effect'

export const retention = Duration.days(7)

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const cacheFile = new RegExp(`^${uuid}(\\.${uuid}\\.part|\\.imagebytes)$`, 'i')

export type EntryType = 'file' | 'symlink' | 'directory' | 'other'

export interface Entry {
  readonly name: string
  readonly type: EntryType
  /** Epoch milliseconds. */
  readonly modifiedAt: number
}

/**
 * The names the cache may delete: `<imageId>.imagebytes` and `<imageId>.<uuid>.part` that are
 * regular files last modified more than seven days before `now`. A wrong `CRIA_MCP_IMAGE_DIR`
 * therefore costs nothing the server did not write.
 */
export const expired = (now: number, entries: ReadonlyArray<Entry>): ReadonlyArray<string> =>
  entries.filter(entry => entry.type === 'file' && cacheFile.test(entry.name) && now - entry.modifiedAt > Duration.toMillis(retention)).map(entry => entry.name)

export const imageFileName = (imageId: string) => `${imageId}.imagebytes`

export const partFileName = (imageId: string, nonce: string) => `${imageId}.${nonce}.part`
