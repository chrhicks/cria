/**
 * INDI boundary: the log of protocol problems. Every element Cria cannot read is reported here once with enough to
 * find it again, and a stream of the same junk cannot flood the log: a repeat of the same problem is counted and
 * folded into the next line, at most one line a minute for it and `maxLinesPerWindow` for all of them.
 */
import type { ProtocolProblem } from './xml.js'

export interface ProblemLogOptions {
  readonly warn: (line: string) => void
  readonly now: () => number
  readonly windowMs?: number
  readonly maxLinesPerWindow?: number
}

/** Bounds the memory of the repeat check: junk with a new name each time must not grow it for ever. */
const maxKeys = 256

export class ProblemLog {
  private count = 0
  private readonly seen = new Map<string, { loggedAt: number; suppressed: number }>()
  private windowStartedAt = Number.NEGATIVE_INFINITY
  private linesInWindow = 0
  private overflow = 0

  private readonly options: ProblemLogOptions

  constructor(options: ProblemLogOptions) {
    this.options = options
  }

  /** Problems seen so far, logged or not. */
  get total(): number {
    return this.count
  }

  /** Reports a problem; returns whether a line was written. `consequence` says what Cria did about it. */
  report(problem: ProtocolProblem, consequence: string): boolean {
    const where = [problem.device === undefined ? '' : `device="${problem.device}"`, problem.name === undefined ? '' : `name="${problem.name}"`]
      .filter(Boolean)
      .join(' ')
    const key = `${consequence}|${problem.tag}|${problem.device ?? ''}|${problem.name ?? ''}|${problem.reason}`

    return this.line(
      key,
      n =>
        `INDI protocol error #${n}: ${consequence}: ${problem.reason}; <${problem.tag}> ${where || 'no device or name'}, ${problem.bytes} bytes${problem.utf8 ? '' : ', not valid UTF-8'}: ${problem.excerpt}`,
    )
  }

  private line(key: string, text: (n: number) => string): boolean {
    const { now, warn, windowMs = 60_000, maxLinesPerWindow = 20 } = this.options
    const at = now()
    const entry = this.seen.get(key)

    this.count += 1
    if (entry && at - entry.loggedAt < windowMs) {
      entry.suppressed += 1

      return false
    }

    if (at - this.windowStartedAt >= windowMs) {
      this.windowStartedAt = at
      this.linesInWindow = 0
    }

    if (this.linesInWindow >= maxLinesPerWindow) {
      this.overflow += 1

      return false
    }

    this.linesInWindow += 1
    const suppressed = (entry?.suppressed ?? 0) + this.overflow

    this.overflow = 0
    if (!entry && this.seen.size >= maxKeys) this.seen.clear()
    this.seen.set(key, { loggedAt: at, suppressed: 0 })
    warn(suppressed > 0 ? `${text(this.count)} (${suppressed} more since the last line)` : text(this.count))

    return true
  }
}
