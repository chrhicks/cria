import { readFileSync } from 'node:fs'
import { ConfigProvider, Effect, Layer } from 'effect'

export const fileNamedOnCommandLine = Layer.suspend(() => {
  const path = process.argv[2]

  if (!path) return Layer.effectDiscard(Effect.die('usage: <program> <config.json>'))

  return ConfigProvider.layer(ConfigProvider.fromUnknown(JSON.parse(readFileSync(path, 'utf8'))))
})
