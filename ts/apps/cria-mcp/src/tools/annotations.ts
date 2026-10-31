import type { Schema } from 'effect'
import { Tool } from 'effect/ai'

type ToolConfig = {
  readonly parameters: Schema.Constraint
  readonly success: Schema.Constraint
  readonly failure: Schema.Constraint
  readonly failureMode: Tool.FailureMode
}

/** Every hint is set: Effect defaults a tool to `destructiveHint: true`, and the Executor app holds a tool for approval on that hint. */
const annotated = <N extends string, C extends ToolConfig, R>(tool: Tool.Tool<N, C, R>, hints: { readonly readonly: boolean; readonly destructive: boolean; readonly idempotent: boolean }) =>
  tool.annotate(Tool.Strict, true).annotate(Tool.Readonly, hints.readonly).annotate(Tool.Destructive, hints.destructive).annotate(Tool.Idempotent, hints.idempotent).annotate(Tool.OpenWorld, false)

/** A read of Cria or of this host's image directory: no call changes the rig. */
export const read = <N extends string, C extends ToolConfig, R>(tool: Tool.Tool<N, C, R>) => annotated(tool, { readonly: true, destructive: false, idempotent: true })

/**
 * A call that can change the rig. `destructive` is whether the Executor app holds the call for approval, and a stop must never wait for one:
 * the wire's halt kinds and `cancel` only stop motion, so they are not destructive; every other command and `recover` are.
 * No call is idempotent, because sending it again can act again.
 */
export const change = <N extends string, C extends ToolConfig, R>(tool: Tool.Tool<N, C, R>, destructive: boolean) =>
  annotated(tool, { readonly: false, destructive, idempotent: false })
