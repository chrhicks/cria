export type JsonRecord = Readonly<Record<string, unknown>>

export function parseRecord(text: string): JsonRecord | undefined {
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined
  } catch {
    return undefined
  }
}

export function stringField(record: JsonRecord, name: string) {
  const value = record[name]

  return typeof value === 'string' ? value : undefined
}
