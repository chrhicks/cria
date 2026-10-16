import type { CommandKind } from '@cria/wire'
import { describe, expectTypeOf, it } from 'vitest'
import type { Workflows } from './workflows.js'

describe('workflow table', () => {
  it('has one workflow per wire command kind', () => {
    expectTypeOf<keyof Workflows>().toEqualTypeOf<CommandKind>()
  })
})
