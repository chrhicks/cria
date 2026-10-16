/**
 * Primitive: Quarantine (new, see docs/ts/SPEC.md). Turns "an uncertain
 * outcome" into "this device takes no more commands until a person says it is
 * safe".
 */
import type { Outcome } from './outcome.js'

export type QuarantineState =
  | { readonly held: false }
  | { readonly held: true; readonly reason: string; readonly since: number }

/** A person checked the equipment and says it is safe to command again. */
export interface ExternalRecovery {
  readonly confirmed: true
  readonly note: string
}

/** Held from the first uncertain ending since the last recovery, oldest first. */
export function quarantineOf(sinceRecovery: Iterable<{ readonly outcome: Outcome<unknown>; readonly settledAt: number }>): QuarantineState {
  for (const ending of sinceRecovery)
    if (ending.outcome.kind === 'uncertain') return { held: true, reason: ending.outcome.message, since: ending.settledAt }

  return { held: false }
}
