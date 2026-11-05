import { readFileSync } from 'node:fs'
import { Schema } from 'effect'

export const Broker = Schema.Struct({
  servers: Schema.String,
  user: Schema.String,
  pass: Schema.String,
})

export function loadConfig<S extends Schema.Top & { readonly DecodingServices: never }>(usage: string, schema: S): S['Type'] {
  const path = process.argv[2]

  if (!path) {
    console.error(`usage: ${usage} <config.json>`)
    process.exit(2)
  }

  return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, 'utf8')))
}
