import { Schema, SchemaAST } from 'effect'
import { commands, requestIdentity, type CommandKind } from '@cria/wire'

/**
 * What a command tool takes: the five identity fields and the command's `parameters`, which is
 * everything an `OperationRequest` holds except `kind`, because the tool name is the kind. A kind
 * with no parameters takes no `parameters` key; an empty struct would show agents a schema that
 * says nothing. Decoding runs the wire's own checks, including the ones JSON Schema cannot show.
 */
export type CommandInput<K extends CommandKind> =
  | Schema.Struct<typeof requestIdentity & { readonly parameters: (typeof commands)[K]['parameters'] }>
  | Schema.Struct<typeof requestIdentity>

const hasFields = (parameters: Schema.Top) => SchemaAST.isObjects(parameters.ast) && parameters.ast.propertySignatures.length > 0

export const commandInput = <K extends CommandKind>(kind: K): CommandInput<K> => {
  const { parameters } = commands[kind]

  return hasFields(parameters) ? Schema.Struct({ ...requestIdentity, parameters }) : Schema.Struct(requestIdentity)
}
