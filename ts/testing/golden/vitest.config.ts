import { defineConfig } from 'vitest/config'
import base from '../../vitest.config.js'

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['testing/golden/wire.golden.ts'], testTimeout: 300_000 },
})
