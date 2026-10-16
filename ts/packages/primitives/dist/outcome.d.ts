/**
 * Primitive: Outcome, the vocabulary of a physical command.
 *
 * Inside Effect code an Outcome is the error channel: the success value is
 * `confirmed`, and `Failed`, `Stopped` and `Uncertain` are tagged errors, so `yield*`
 * unwraps a confirmed result and every other ending travels up until something
 * matches it by tag. At a boundary that must report an ending (a Run, the wire),
 * `settle` turns the Effect into the plain `Outcome` union.
 */
import { Cause, Effect, Exit } from 'effect';
/** Known not to have taken effect. */
export declare const failedReasons: readonly ['busy', 'blocked', 'disconnected', 'unsupported', 'rejected', 'invalid', 'unavailable'];
export type FailedReason = (typeof failedReasons)[number];
/** May have taken effect. Stop, tell a person, never resend. */
export declare const uncertainReasons: readonly ['no-acknowledgement', 'not-confirmed', 'stop-not-confirmed', 'connection-lost', 'driver-lost', 'unexpected-error'];
export type UncertainReason = (typeof uncertainReasons)[number];
declare const Failed_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "Failed";
} & Readonly<A>;
export declare class Failed extends Failed_base<{
    readonly reason: FailedReason;
    readonly message: string;
}> {
}
declare const Stopped_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "Stopped";
} & Readonly<A>;
/** Cancellation was requested and the device confirmed it stopped. */
export declare class Stopped extends Stopped_base<{}> {
}
declare const Uncertain_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "Uncertain";
} & Readonly<A>;
export declare class Uncertain extends Uncertain_base<{
    readonly reason: UncertainReason;
    readonly message: string;
}> {
}
/** Every way a command can end other than confirmed. */
export type Ending = Failed | Stopped | Uncertain;
export type Outcome<A> = {
    readonly kind: 'confirmed';
    readonly value: A;
} | {
    readonly kind: 'failed';
    readonly reason: FailedReason;
    readonly message: string;
} | {
    readonly kind: 'stopped';
} | {
    readonly kind: 'uncertain';
    readonly reason: UncertainReason;
    readonly message: string;
};
export declare const confirmed: <A>(value: A) => Outcome<A>;
/**
 * Classify how an Effect ended. When the cause carries several endings (an
 * interrupted run whose stop also failed), the least certain one wins:
 * uncertain > failed > stopped. A defect is uncertain: a bug after a write
 * proves nothing about the equipment.
 */
export declare function fromExit<A>(exit: Exit.Exit<A, Ending>): Outcome<A>;
/** The one sanctioned way to stop an ending from propagating: turn it into a value. */
export declare function settle<A, R>(effect: Effect.Effect<A, Ending, R>): Effect.Effect<Outcome<A>, never, R>;
export {};
//# sourceMappingURL=outcome.d.ts.map