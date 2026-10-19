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

const maxReasonChars = 200
// The excerpt arrives already escaped (up to six characters for each of its 200), so this only guards other callers.
const maxExcerptChars = 1300
const maxIdentityChars = 100
const maxTagChars = 40

const escapes: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/**
 * Everything in a problem came from the driver, so none of it is trusted to be short or to stay on one line: cut to
 * `max` characters, then every control character (and the Unicode line separators) written as an escape.
 * `quoted` also escapes `"` and `\` so a name cannot close the quotes it is printed in.
 */
function shown(text: string, max: number, quoted = false): string {
  const cut = text.length > max ? `${text.slice(0, max)}...` : text
  const pattern = quoted ? /[\u0000-\u001f\u007f-\u009f\u2028\u2029"\\]/g : /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

  return cut.replace(pattern, character => escapes[character] ?? (character === '"' || character === '\\' ? `\\${character}` : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`))
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
    const reason = shown(problem.reason, maxReasonChars)
    const tag = shown(problem.tag, maxTagChars)
    const device = problem.device === undefined ? undefined : shown(problem.device, maxIdentityChars, true)
    const name = problem.name === undefined ? undefined : shown(problem.name, maxIdentityChars, true)
    const where = [device === undefined ? '' : `device="${device}"`, name === undefined ? '' : `name="${name}"`].filter(Boolean).join(' ')
    const key = `${consequence}|${tag}|${device ?? ''}|${name ?? ''}|${reason}`
    const excerpt = shown(problem.excerpt, maxExcerptChars)

    return this.line(
      key,
      n =>
        `INDI protocol error #${n}: ${consequence}: ${reason}; <${tag}> ${where || 'no device or name'}, ${problem.bytes} bytes${problem.utf8 ? '' : ', not valid UTF-8'}: ${excerpt}`,
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
