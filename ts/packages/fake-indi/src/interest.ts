interface DeviceInterest {
  all: boolean
  readonly names: Set<string>
}

/**
 * Which properties a client hears about, as indiserver 2.2.5 keeps it (measured, see measure/): a list of
 * (device, property) entries a client adds to with `getProperties` and `enableBLOB`, and nothing it never
 * named is delivered. A device without a property name covers the whole device; no device covers everything.
 * A driver's definition, update, deletion or message goes to every client with a matching entry, whoever asked.
 * A request for everything counts only from a client that has named nothing yet: after a device or a property,
 * indiserver answers it but does not widen what the client hears (measured: measure/measure-blob-scope.py).
 */
export class Interest {
  private everything = false
  private readonly devices = new Map<string, DeviceInterest>()

  add(device: string | undefined, property: string | undefined): void {
    if (device === undefined) {
      if (this.devices.size === 0) this.everything = true

      return
    }

    const entry = this.devices.get(device) ?? { all: false, names: new Set<string>() }

    if (property === undefined) entry.all = true
    else entry.names.add(property)
    this.devices.set(device, entry)
  }

  /**
   * Whether a message for `property` of `device` reaches the client. A message about the whole device (a
   * `<message>`, a deletion of the device) has no property and reaches only a client that watches the whole
   * device: one that named a property does not hear it (measured: measure/measure-routing.py).
   */
  covers(device: string, property?: string): boolean {
    if (this.everything) return true

    const entry = this.devices.get(device)

    if (!entry) return false

    return entry.all || (property !== undefined && entry.names.has(property))
  }
}
