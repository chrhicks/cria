import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import { OperationRequest, commands as wire } from '@cria/wire'
import { Cria } from '../cria.js'
import { commands, exposedKinds, type ExposedKind } from '../exposure.js'
import { commandInput } from '../input.js'
import { Reply, toReply } from '../reply.js'
import { change } from './annotations.js'

const footer =
  'Copy instanceId, deviceId, bindingId and expectedName (the device name) from `state`, and choose your own requestId. Cria may refuse the command; its refusal comes back unchanged. ' +
  'Returns as soon as Cria accepts, usually running: follow with `wait`. If the answer is lost, Cria may or may not have acted: call `request` with the same requestId before sending again.'

const commandTool = <K extends ExposedKind>(kind: K) =>
  change(Tool.make(kind, { description: `${commands[kind].description}\n\n${footer}`, parameters: commandInput(kind), success: Reply }), !wire[kind].halt)

type CommandTools = { readonly [K in ExposedKind]: ReturnType<typeof commandTool<K>> }

/** The tool list comes from data, so TypeScript cannot know the keys; the table in exposure.ts does, and the tests check the two agree. */
const tools = Object.fromEntries(exposedKinds.map(kind => [kind, commandTool(kind)])) as unknown as CommandTools

export const CommandToolkit = Toolkit.make(...Object.values(tools))

type Input = { readonly parameters?: object } & Record<string, unknown>

export const CommandHandlers = CommandToolkit.toLayer(
  Effect.gen(function* () {
    const cria = yield* Cria

    const submit = (kind: ExposedKind) => (input: Input) => {
      const { parameters, ...identity } = input

      return Schema.decodeUnknownEffect(OperationRequest)({ ...identity, kind, parameters: parameters ?? {} }).pipe(
        Effect.orDie,
        Effect.flatMap(request => toReply(cria.submit(request))),
      )
    }

    return Object.fromEntries(exposedKinds.map(kind => [kind, submit(kind)])) as never
  }),
)
