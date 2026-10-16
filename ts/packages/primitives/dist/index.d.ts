export { Failed, Stopped, Uncertain, confirmed, failedReasons, uncertainReasons, fromExit, settle, type Ending, type FailedReason, type Outcome, type UncertainReason, } from './outcome.js';
export * as Reading from './reading.js';
export { unavailableReasons } from './reading.js';
export type { Reading as ReadingOf, UnavailableReason } from './reading.js';
export { writeOnce, type Answer, type WriteOnce } from './discipline/write-once.js';
export { confirm, writeConfirmed, type Confirm } from './discipline/confirm.js';
export { stoppable, type Stoppable } from './discipline/stoppable.js';
export { retryReads, type ReadResult, type RetryReads } from './discipline/retry-reads.js';
export { quarantineOf, type ExternalRecovery, type QuarantineState } from './quarantine.js';
export { makeRun, type Report, type Run, type RunDefinition, type RunView } from './run.js';
//# sourceMappingURL=index.d.ts.map