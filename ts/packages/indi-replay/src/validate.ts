/**
 * What the INDI library does with a client's write that a property cannot take, as indiserver 2.2.5's simulator
 * drivers (ccd, focus, telescope, weather) were measured doing it. The same code answers in every driver built on
 * the library, so it is the one refusal a replay can give without knowing the driver:
 *
 * - A number outside its `min`..`max`: nothing is applied, not the elements that were in range either. The driver
 *   says Alert with the reason on the first element out of range (in the order the client sent them), and the
 *   values it still holds. The driver's own handler then usually reports the property Ok, with those values and no
 *   message (94 of 94 clean cases in the simulators; a few drivers add more, which depends on their code).
 * - A OneOfMany switch whose written elements do not have exactly one On (those not written count as Off): the
 *   driver says Idle with the reason and the values it holds, and nothing more.
 *
 * What a driver refuses by its own rules (a binning it does not have, a temperature out of reach) is its code and
 * comes only from a recording.
 *
 * Not applicable: what the focuser does to its other properties after it refuses a FOCUS_MAX write (its ABS step
 * becomes 2000, REL max 50000, FOCUS_SYNC step 2000, Presets max 4294970000, each with a set; measured with
 * indiserver 2.2.5) is the focuser's own code, and a replay holds the old limits and sends none of those sets. Cria
 * cannot ask for that write: its focuser operations are `focuser-move` and `focuser-halt`
 * (`apps/cria/src/operation/workflows.ts:71-72`), which send ABS_FOCUS_POSITION through `startMotion`
 * (`apps/cria/src/capability/focuser.ts:103`) and FOCUS_ABORT_MOTION through `sendOnce`
 * (`apps/cria/src/capability/focuser.ts:81`). Nothing in `apps/cria/src` sends FOCUS_MAX; it is only read
 * (`focuser.ts:34-35`). The exported INDI client would send it if a caller asked
 * (`packages/indi/src/client.ts:204-213`), and then the replay's answer to it (Alert, then Ok, as measured) is what
 * matches.
 */
import type { FakeVector } from '@cria/fake-indi'

export interface Refusal {
  readonly state: FakeVector['state']
  readonly message: string
  /** What the driver reports next, when it reports anything: the property's state, with its values and no message. */
  readonly then?: FakeVector['state']
}

/** A number as C's `printf("%g")` writes it, which is how the library words its limits and the requested value. */
export function formatG(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf'
  if (value === 0) return '0'
  const [mantissa, exponent] = value.toExponential(5).split('e') as [string, string]
  const power = Number(exponent)

  if (power < -4 || power >= 6) return `${mantissa.replace(/\.?0+$/, '')}e${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`

  return String(Number(value.toFixed(5 - power)))
}

export function refusal(vector: FakeVector, values: Readonly<Record<string, string>>): Refusal | undefined {
  const label = vector.label ?? vector.name

  if (vector.kind === 'number') {
    for (const [name, text] of Object.entries(values)) {
      const element = vector.elements[name]
      const requested = Number(text)

      if (element?.min === undefined || element.max === undefined || (requested >= element.min && requested <= element.max) || Number.isNaN(requested)) continue

      return {
        state: 'Alert',
        message: `Error: Invalid range for ${element.label ?? name} (${name}). Valid range is from ${formatG(element.min)} to ${formatG(element.max)}. Requested value is ${formatG(requested)}`,
        then: 'Ok',
      }
    }

    return undefined
  }

  if (vector.kind === 'switch' && vector.rule === 'OneOfMany') {
    const on = Object.entries(values).filter(([name, value]) => name in vector.elements && value === 'On').length

    if (on !== 1) return { state: 'Idle', message: `Error: invalid state switch for property ${label} (${vector.name}). ${on === 0 ? 'No switch is on' : 'Too many switches are on'}.` }
  }

  return undefined
}
