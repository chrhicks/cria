export type BlobMode = 'Never' | 'Also' | 'Only'

interface DeviceSetting {
  readonly mode: BlobMode
  readonly properties: ReadonlyMap<string, BlobMode>
}

const unset: DeviceSetting = { mode: 'Never', properties: new Map() }

/**
 * One client's `enableBLOB` state, as indiserver 2.2.5 keeps it (measured over every ordered sequence of
 * up to three commands, see measure/): per device a mode plus per-property overrides.
 *
 * - A device-wide command sets the device's mode and drops that device's property overrides.
 * - A property command sets that property's override and leaves the rest alone.
 * - A property's images follow its override, else the device's mode, else `Never`.
 * - Everything but images is withheld from the client only while the device's own mode is `Only`; a
 *   property override never lifts or imposes that.
 */
export class BlobSettings {
  private readonly devices = new Map<string, DeviceSetting>()

  set(device: string, property: string | undefined, mode: BlobMode): void {
    const current = this.devices.get(device) ?? unset

    this.devices.set(
      device,
      property === undefined ? { mode, properties: new Map() } : { mode: current.mode, properties: new Map(current.properties).set(property, mode) },
    )
  }

  wantsImage(device: string, property: string): boolean {
    const setting = this.devices.get(device) ?? unset

    return (setting.properties.get(property) ?? setting.mode) !== 'Never'
  }

  /** Whether definitions, updates and deletions for `device` are withheld. */
  withholdsOthers(device: string): boolean {
    return (this.devices.get(device) ?? unset).mode === 'Only'
  }
}
