#!/usr/bin/env node
import { loadConfig } from './config.js'
import { startService } from './service.js'

const path = process.argv[2] ?? process.env.CRIA_CONFIG

if (!path) {
  console.error('usage: cria <config.json>')
  process.exit(2)
}

const service = await startService(loadConfig(path))

console.error(`cria: instance ${service.rig.instanceId} listening on ${service.port}`)

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.error(`cria: ${signal}, stopping`)
    void service.stop().then(() => process.exit(0))
  })
}
