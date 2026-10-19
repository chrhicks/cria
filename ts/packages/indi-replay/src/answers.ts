/**
 * The sets a driver sends inside its answer to a device-wide `getProperties`, read from a recording. The telescope
 * simulator defines its properties and, between two of them, sets TELESCOPE_MOUNT_TYPE (measured with indiserver
 * 2.2.5: on every device-wide ask, never on an ask that names a property).
 *
 * An answer is read from what the driver said, not from which request it follows. indiserver relays a driver's
 * words to every client, and a driver answers late, so the recorder hears an answer after requests that asked for
 * something else, and answers to asks of other clients it never saw. An answer is a run of one device's
 * definitions: other devices' words and standalone messages between them do not break it; a device-wide ask for
 * the device, an update that is not followed by more of the run's definitions, an update of CONNECTION (what
 * follows is what the connection brings), a definition that begins the driver's list again, or a definition of a
 * property the run has already updated, ends it. A run that defines one property answers an ask that named it,
 * and is not counted.
 *
 * A run answers a recorded ask when it is the first run of its device after a device-wide ask for it, whatever
 * else the client sent in between. The others answer an ask the recorder did not see, or are the definitions a
 * connection brings; a recording cannot say which.
 *
 * A property has an answer set when no run carried more than one update of it, after its definition and before the
 * run's last one, no run that answers a recorded ask lacked it, and the driver never updated it anywhere else in
 * the recording: a property the driver reports as it goes (a position, a state) is updated outside the answers
 * too. One run is enough when it answers a recorded ask; otherwise two are needed, because a driver also sets
 * things when a connection brings its properties, once. The set is placed after the definition that came before
 * it from the same device.
 */
import type { ServerElement } from './xml.js'

/** A driver lists its properties from CONNECTION, once: a definition of CONNECTION that does not repeat the one before begins another list. */
export const beginsList = (previous: string | undefined, name: string): boolean => name === 'CONNECTION' && previous !== undefined && previous !== 'CONNECTION'

export interface AnswerSet {
  /** The property of the same device whose definition the driver sent just before this set. */
  readonly after: string
  readonly timeout?: number
  readonly message?: string
}

interface Said {
  readonly index: number
  readonly kind: 'define' | 'update'
  readonly name: string
  readonly set: Omit<AnswerSet, 'after'>
  /** The device-wide asks the client had sent when the driver said it: a new one ends the run. */
  readonly asks: string
  /** A definition that is the first of its device since a device-wide ask for it. */
  readonly answersAsk: boolean
}

interface Tally {
  readonly withOne: Array<{ readonly index: number; readonly set: AnswerSet }>
  answersAsk: boolean
  /** Some run carried more than one update, or lacked it though it answers a recorded ask. */
  broken: boolean
}

export class AnswerCounter {
  private asksOfAll = 0
  private readonly asksOf = new Map<string, number>()
  private readonly heardAll = new Map<string, number>()
  private readonly heardOf = new Map<string, number>()
  private readonly said = new Map<string, Said[]>()

  /** Something the client sent; a device-wide ask ends the answers before it. */
  client(ask: { readonly device: string | undefined; readonly name: string | undefined } | undefined): void {
    if (ask === undefined || ask.name !== undefined) return
    if (ask.device === undefined) this.asksOfAll += 1
    else this.asksOf.set(ask.device, (this.asksOf.get(ask.device) ?? 0) + 1)
  }

  /** What the driver sent, as the event at `index` of the recording. */
  server(index: number, element: ServerElement): void {
    if (element.kind !== 'define' && element.kind !== 'update') return
    const device = element.kind === 'define' ? element.vector.device : element.device
    const set = element.kind === 'define' ? {} : { ...(element.timeout === undefined ? {} : { timeout: element.timeout }), ...(element.message === undefined ? {} : { message: element.message }) }
    const asked = this.asksOf.get(device) ?? 0
    const answersAsk = element.kind === 'define' && (this.asksOfAll > (this.heardAll.get(device) ?? 0) || asked > (this.heardOf.get(device) ?? 0))

    if (element.kind === 'define') {
      this.heardAll.set(device, this.asksOfAll)
      this.heardOf.set(device, asked)
    }
    const said = this.said.get(device) ?? []

    said.push({ index, kind: element.kind, name: element.kind === 'define' ? element.vector.name : element.name, set, asks: `${this.asksOfAll}.${asked}`, answersAsk })
    this.said.set(device, said)
  }

  /** The answer set of each property that has one, by `device.name`, and the indexes of the recorded events that are those sets. */
  found(): { readonly sets: ReadonlyMap<string, AnswerSet>; readonly indexes: ReadonlyArray<number> } {
    const tallies = new Map<string, Tally>()
    const elsewhere = new Set<string>()

    for (const [device, said] of this.said) {
      let run: Said[] = []
      const defined = new Set<string>()
      const updated = new Set<string>()
      const sets: Array<{ readonly said: Said; readonly after: string }> = []
      let after: string | undefined

      const end = () => {
        const last = run.map(entry => entry.kind).lastIndexOf('define')
        const answer = defined.size > 1
        const answersAsk = run.some(entry => entry.answersAsk)

        for (const set of sets) if (!answer || run.indexOf(set.said) > last) elsewhere.add(`${device}.${set.said.name}`)
        if (answer) {
          for (const name of defined) {
            const tally = tallies.get(`${device}.${name}`) ?? { withOne: [], answersAsk: false, broken: false }
            const sent = sets.filter(set => set.said.name === name && run.indexOf(set.said) < last)

            if (sent.length === 1) tally.withOne.push({ index: sent[0]!.said.index, set: { after: sent[0]!.after, ...sent[0]!.said.set } })
            if (sent.length > 1 || (sent.length === 0 && answersAsk)) tally.broken = true
            if (answersAsk && sent.length === 1) tally.answersAsk = true
            tallies.set(`${device}.${name}`, tally)
          }
        }
        run = []
        sets.length = 0
        defined.clear()
        updated.clear()
        after = undefined
      }

      for (let at = 0; at < said.length; at += 1) {
        const entry = said[at]!

        if (entry.kind === 'define') {
          if (run.length > 0 && (run[0]!.asks !== entry.asks || updated.has(entry.name) || beginsList(after, entry.name))) end()
          run.push(entry)
          defined.add(entry.name)
          after = entry.name
          continue
        }

        // A streak of updates sits inside the run when more of its definitions follow, and the run goes on.
        let stop = at

        while (stop < said.length && said[stop]!.kind === 'update' && said[stop]!.asks === entry.asks) stop += 1
        const streak = said.slice(at, stop)
        const next = said[stop]
        const inside = !streak.some(update => update.name === 'CONNECTION') && run.length > 0 && run[0]!.asks === entry.asks && next !== undefined && next.kind === 'define' && next.asks === entry.asks && !updated.has(next.name) && !streak.some(update => update.name === next.name && defined.has(update.name))

        for (const update of streak) {
          if (inside && defined.has(update.name) && after !== undefined) {
            run.push(update)
            updated.add(update.name)
            sets.push({ said: update, after })
          } else if (!inside) elsewhere.add(`${device}.${update.name}`)
        }
        if (!inside) end()
        at = stop - 1
      }
      end()
    }

    const complete = [...tallies].filter(([slot, tally]) => !tally.broken && !elsewhere.has(slot) && (tally.answersAsk || tally.withOne.length > 1))

    return { sets: new Map(complete.map(([slot, tally]) => [slot, tally.withOne.at(-1)!.set])), indexes: complete.flatMap(([, tally]) => tally.withOne.map(update => update.index)) }
  }
}
