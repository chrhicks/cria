/**
 * The sets a driver sends inside its answer to a device-wide `getProperties`, read from a recording. The telescope
 * simulator defines its properties and, between two of them, sets TELESCOPE_MOUNT_TYPE (measured with indiserver
 * 2.2.5: on every device-wide ask, never on an ask that names a property).
 *
 * The answer to an ask is what the asked device's driver says until the client's next command (every driver, for an
 * ask that names no device). A property has an answer set when
 * each answer that defined it carried exactly one update of it, after its definition, and the driver never updated
 * it anywhere else in the recording: a property the driver reports as it goes (a position, a state) is updated
 * outside the answers too, and an update that fell inside one is not part of it. The set is placed after the
 * definition that came before it from the same device.
 */
import type { ServerElement } from './xml.js'

export interface AnswerSet {
  /** The property of the same device whose definition the driver sent just before this set. */
  readonly after: string
  readonly timeout?: number
  readonly message?: string
}

interface Update {
  readonly index: number
  readonly set: AnswerSet
}

export class AnswerCounter {
  private open = false
  private scope: string | undefined
  private readonly defined = new Set<string>()
  private readonly lastDefined = new Map<string, string>()
  private readonly updates = new Map<string, Update[]>()
  private readonly elsewhere = new Set<string>()
  private readonly answers = new Map<string, { windows: number; withOne: number; updates: Update[] }>()

  /** Something the client sent; a device-wide ask opens an answer, anything else closes it. */
  client(ask: { readonly device: string | undefined; readonly name: string | undefined } | undefined): void {
    this.close()
    this.open = ask !== undefined && ask.name === undefined
    this.scope = ask?.device
  }

  /** What the driver sent, as the event at `index` of the recording. */
  server(index: number, element: ServerElement): void {
    if (element.kind !== 'define' && element.kind !== 'update') return
    const device = element.kind === 'define' ? element.vector.device : element.device
    const name = element.kind === 'define' ? element.vector.name : element.name
    const slot = `${device}.${name}`
    const answering = this.open && (this.scope === undefined || this.scope === device)

    if (element.kind === 'update' && !answering) this.elsewhere.add(slot)
    if (!answering) return

    if (element.kind === 'define') {
      this.defined.add(slot)
      this.lastDefined.set(device, name)

      return
    }

    const after = this.lastDefined.get(device)

    if (!this.defined.has(slot) || after === undefined) return
    this.updates.set(slot, [...(this.updates.get(slot) ?? []), { index, set: { after, ...(element.timeout === undefined ? {} : { timeout: element.timeout }), ...(element.message === undefined ? {} : { message: element.message }) } }])
  }

  private close(): void {
    for (const slot of this.defined) {
      const sent = this.updates.get(slot) ?? []
      const known = this.answers.get(slot) ?? { windows: 0, withOne: 0, updates: [] }

      known.windows += 1
      if (sent.length === 1) {
        known.withOne += 1
        known.updates.push(sent[0]!)
      }
      this.answers.set(slot, known)
    }
    this.defined.clear()
    this.lastDefined.clear()
    this.updates.clear()
  }

  /** The answer set of each property that has one, by `device.name`, and the indexes of the recorded events that are those sets. */
  found(): { readonly sets: ReadonlyMap<string, AnswerSet>; readonly indexes: ReadonlyArray<number> } {
    this.close()
    const complete = [...this.answers].filter(([slot, answer]) => answer.windows === answer.withOne && !this.elsewhere.has(slot))

    return { sets: new Map(complete.map(([slot, answer]) => [slot, answer.updates.at(-1)!.set])), indexes: complete.flatMap(([, answer]) => answer.updates.map(update => update.index)) }
  }
}
