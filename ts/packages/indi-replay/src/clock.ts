/** Time as replay uses it: real time. Tests pass a clock they advance by hand. */
export interface Clock {
  /** Epoch milliseconds. */
  readonly now: () => number
  /** Runs `run` after `ms`; returns a function that cancels it. */
  readonly after: (ms: number, run: () => void) => () => void
}

export const realClock: Clock = {
  now: () => Date.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms)

    timer.unref()

    return () => clearTimeout(timer)
  },
}
