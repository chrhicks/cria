import { defineConfig } from 'vitest/config'

// Tests run against workspace sources (the "@cria/source" export condition), so
// they don't depend on a previous build. The condition is namespaced so that a
// consumer's tooling never picks up TypeScript sources from node_modules.
export default defineConfig({
  resolve: { conditions: ['@cria/source'] },
  ssr: { resolve: { conditions: ['@cria/source'] } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'testing/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
