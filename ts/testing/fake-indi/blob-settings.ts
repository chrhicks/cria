export type BlobMode = 'Never' | 'Also' | 'Only'

/**
 * One client's `enableBLOB` state, as indiserver 2.2.5 keeps it (measured over every ordered sequence of up
 * to three commands over two devices, see measure/measure-blob-scope.py): one mode for the client, and
 * overrides for single properties.
 *
 * - A device-wide command, for whichever device, sets the client's mode and drops every override.
 * - A property command sets that property's override and leaves the rest alone.
 * - A property's images follow its override, else the client's mode (`Never` until a command sets it).
 * - Everything but images is withheld from the client while its mode is `Only`; an override never lifts or
 *   imposes that.
 */
export class BlobSettings {
  private mode: BlobMode = 'Never'
  private readonly properties = new Map<string, BlobMode>()

  set(device: string, property: string | undefined, mode: BlobMode): void {
    if (property === undefined) {
      this.mode = mode
      this.properties.clear()
    } else {
      this.properties.set(key(device, property), mode)
    }
  }

  wantsImage(device: string, property: string): boolean {
    return (this.properties.get(key(device, property)) ?? this.mode) !== 'Never'
  }

  /** Whether everything but images is withheld from this client. */
  withholdsOthers(): boolean {
    return this.mode === 'Only'
  }
}

const key = (device: string, property: string) => `${device}\u0000${property}`
