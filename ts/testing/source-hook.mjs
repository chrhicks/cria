import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const source = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL)

      if (existsSync(fileURLToPath(source))) return next(source.href, context)
    }

    return next(specifier, context)
  },
})
