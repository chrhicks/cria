# INDI input Cria cannot read

`xml.ts` frames and parses what indiserver sends, `problems.ts` logs what it cannot read, `client.ts` decides what to do about it.

- A bad element whose extent is known (no device or name, a number that is not a number, an unknown state, an unknown tag) is skipped and logged, and the connection stays. A deterministic bad element would otherwise reconnect and re-read the same bytes for ever, taking every device down with it (the first real errai recording, 2026-10-19).
- A `def*Vector` or `set*Vector` with one element whose name is missing or empty is kept: that element alone is left out, the other elements stay, and the problem is logged. The AM5 defines `ALTITUDE_LIMIT_CONTROL` with such an element on every connect, and dropping the whole property hid its good elements.
- Lost framing (an element that never closes, a tag that is not a tag, an unbalanced closing tag) is logged and drops the connection. A new connection is the only safe reset: the client does not reconnect, `closed` resolves and the rig program exits for systemd to start it again.
- A skipped `def*Vector` or `set*Vector` whose device and name can be read forgets that property in the mirror, so subscribers see `deleted` and never a stale value. Each time a problem is logged the driver is asked for that property again (`getProperties`).
- One log line per problem, with the driver's text bounded and escaped. A repeat of the same problem is logged once a minute and counted into the next line, and all problems together are capped at 20 lines a minute (`problems.ts`).
- A `setBLOBVector` is framed and skipped, never decoded. Cria never asks indiserver for BLOBs, so none arrive.
- The tap gets every element's wire text, bad ones included.

Each case is a test in `bad-input.test.ts`.
