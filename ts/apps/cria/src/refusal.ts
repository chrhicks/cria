import { Data } from 'effect'
import type { ErrorCode } from '@cria/wire'

export class Refusal extends Data.TaggedError('Refusal')<{
  readonly code: ErrorCode
  readonly message: string
}> {}

export const refuse = (code: ErrorCode, message: string) => new Refusal({ code, message })
