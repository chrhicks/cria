export const failedStep = 'scenario failed'

export interface Entry {
  readonly scenario: string
  readonly step: number
  readonly request: string
  readonly sent?: unknown
  readonly status: number
  readonly body: unknown
}

export interface Recorded {
  readonly request: string
  readonly sent?: unknown
  status: number
  body: unknown
}

export function recordingFetch(into: Recorded[]): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    const entry: Recorded = {
      request: `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
      ...(typeof init?.body === 'string' ? { sent: JSON.parse(init.body) } : {}),
      status: response.status,
      body: await response.clone().json(),
    }

    into.push(entry)

    return response
  }
}

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const utc = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/g

export function normalize(scenario: string, recorded: ReadonlyArray<Recorded>): Entry[] {
  const names = new Map<string, string>()

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, visit((value as Record<string, unknown>)[key])]),
      )
    if (typeof value === 'string')
      return value
        .replace(uuid, id => names.get(id) ?? names.set(id, `<instance-${names.size + 1}>`).get(id)!)
        .replace(utc, '<utc>')
        .replace(/LONG=247\.93\d*/, 'LONG=247.93')

    return value
  }

  return recorded.map((entry, index) => ({
    scenario,
    step: index + 1,
    request: entry.request,
    ...(entry.sent === undefined ? {} : { sent: visit(entry.sent) }),
    status: entry.status,
    body: visit(entry.body),
  }))
}

export function diff(expected: ReadonlyArray<Entry>, actual: ReadonlyArray<Entry>): string[] {
  const report: string[] = []

  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    const want = expected[index]
    const got = actual[index]

    if (got?.request === failedStep) report.push(`scenario "${got.scenario}": the scenario stopped: ${String(got.body)}`)
    else if (!want) report.push(`scenario "${got!.scenario}", step ${got!.step} (${got!.request}): not in the golden`)
    else if (!got) report.push(`scenario "${want.scenario}", step ${want.step} (${want.request}): in the golden, did not run`)
    else if (JSON.stringify(want) !== JSON.stringify(got)) report.push(`scenario "${got.scenario}", step ${got.step} (${got.request}):`, `  golden ${JSON.stringify(want)}`, `  got    ${JSON.stringify(got)}`)
  }

  return report
}
