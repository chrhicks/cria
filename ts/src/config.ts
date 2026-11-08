import { readFileSync } from 'node:fs'
import { Effect, Schema } from 'effect'

export function described<S extends Schema.Top>(description: string, schema: S, value: S['Rebuild']['Encoded']) {
  return Schema.withDecodingDefaultKey<S['Rebuild']>(Effect.succeed(value))(schema.annotate({ description }))
}

export function decodeConfig<S extends Schema.ConstraintDecoder<unknown>>(schema: S, json: unknown): S['Type'] {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(json)
}

export function readConfig<S extends Schema.ConstraintDecoder<unknown>>(schema: S, path: string | undefined): S['Type'] {
  if (!path) throw new Error('usage: <program> <config.json>')

  return decodeConfig(schema, JSON.parse(readFileSync(path, 'utf8')))
}
