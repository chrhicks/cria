/**
 * How many times a driver defines a property in one answer to a device-wide `getProperties`, read from a
 * recording. Drivers do repeat definitions (indi_simulator_ccd answers with ten of its fifteen properties
 * twice, because a base class and the driver both define them), and indiserver relays every copy.
 *
 * A repeat is a definition identical to the one before it for the same property, with no update or deletion
 * of that property between and no `getProperties` asking for it between: two asks answered the same way are
 * two answers, not a repeat. The count is the longest such run seen.
 */
export class RepeatCounter {
  private readonly last = new Map<string, { readonly signature: string; readonly run: number }>()
  private readonly found = new Map<string, number>()

  /** A `getProperties` the client sent: later definitions answer it, so they start new runs. */
  ask(device: string | undefined, name: string | undefined): void {
    for (const slot of this.last.keys()) {
      const [slotDevice, slotName] = split(slot)

      if ((device === undefined || device === slotDevice) && (name === undefined || name === slotName)) this.last.delete(slot)
    }
  }

  /** A definition the driver sent; `signature` is its text without the timestamp. */
  define(device: string, name: string, signature: string): void {
    const slot = `${device}\u0000${name}`
    const previous = this.last.get(slot)
    const run = previous?.signature === signature ? previous.run + 1 : 1

    this.last.set(slot, { signature, run })
    this.found.set(slot, Math.max(this.found.get(slot) ?? 1, run))
  }

  /** The driver changed or deleted the property: the next definition is not a copy of the last. */
  changed(device: string, name: string | undefined): void {
    for (const slot of this.last.keys()) {
      const [slotDevice, slotName] = split(slot)

      if (slotDevice === device && (name === undefined || name === slotName)) this.last.delete(slot)
    }
  }

  /** Repeats above one, by `device.name`. */
  repeats(): ReadonlyMap<string, number> {
    return new Map([...this.found].filter(([, count]) => count > 1).map(([slot, count]) => [slot.replace('\u0000', '.'), count]))
  }
}

const split = (slot: string) => slot.split('\u0000') as [string, string]
