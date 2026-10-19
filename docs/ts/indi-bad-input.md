# INDI client: input Cria cannot read

Status: proposed. Code: `ts/packages/indi` (`xml.ts`, `problems.ts`, `client.ts`). Tests: `ts/packages/indi/src/bad-input.test.ts`.
Parent: "The INDI boundary" in [SPEC.md](SPEC.md#the-indi-boundary).

## Problem

On 2026-10-19 a replay of the first real errai recording served an element Cria's parser rejected. Cria's client
treated any parse error as fatal: it closed the socket, reconnected, read the same bytes, and looped. Every device
read `unavailable`, and the log said nothing. One bad element about one property took down all devices, and nobody
could tell why. A real driver will send something unexpected again (the Pegasus PPBA and ZWO AM5 drivers already send
five definitions with an empty device, name, label and group on each connect). The next one must be visible and must not take Cria down.

## Decision

Two kinds of bad input, two answers.

- **A bad element** (its extent is known, so the next element starts cleanly: a missing or empty name, a number that is
  not a number, an unknown state, an unknown tag): **skip it, log it, keep the connection.**
- **Lost framing** (an element that never closes, a tag that is not a tag, an element over its size limit, an unbalanced
  closing tag): **log it and drop the connection**, as today. Cria cannot tell where the next element starts, so a new
  connection is the only safe reset. The reconnect is paced 250 ms doubling to 5 s, and the log is rate-limited, so a
  deterministic loop is slow and loud rather than silent.

Why not drop-and-log for everything (b)? A deterministic bad element loops for ever, and while it loops every device
is unavailable, including the ones the bad element has nothing to do with. That is what happened on 2026-10-19.

The risk of skipping is a stale value: the update that was skipped might have been the only one for that property, and
`liveness.ts` does not catch it. Its once-a-second read of `CONNECTION` proves the driver answers, not that every
update arrived. So skipping is made safe in the client, not left to liveness:

- A bad `def*Vector` or `set*Vector` whose device and name can be read **forgets that property** in the mirror at once, on
  every occurrence, even when the log line is held back. Subscribers see the same `deleted` event a driver's
  `delProperty` makes, so readings say unavailable, never stale-but-ready. Staleness is bounded at zero. The device and
  property are named exactly as normal parsing names them (UTF-8, entities decoded), so the forgotten property is the
  one the mirror holds. What a command in flight then does is what the capability does with that `deleted` event, not
  one rule for all: an exposure that loses `CCD_EXPOSURE` before the camera has acknowledged it ends `uncertain`
  (`driver-lost`) and the camera stays held. Lost after the camera went Busy, the exposure keeps waiting for its
  frame; if none arrives it fails `unavailable` once the abort is confirmed, without quarantine (the camera is known
  to be idle).
- The driver is asked for the property again (`getProperties` for that device and name) each time a line is logged,
  so at most once a minute per distinct problem. A good answer restores the property. A driver that always sends the
  same bad element is asked once a minute and the property stays unavailable.
- A bad element with no readable device or name belongs to no property, so there is nothing to forget. Its cost is the
  one thing this design cannot bound: an unattributable update could have been the only one for some property. It is
  logged with its bytes. The known case, the empty definitions above, defines nothing.

## What the log says

One line per problem, written through the Effect log at warning level (`options.warn` replaces it in tests):

`INDI protocol error #7: skipped the element: Invalid INDI number "12abc"; <setNumberVector> device="Test Focuser" name="POSITION", 96 bytes: <setNumberVector ...>`

`#7` counts every problem since the client started, logged or not. Every field that came from the driver is
bounded and escaped, so a line is one physical line of a few KB at most however hostile the element: the reason at
200 characters, device and name at 100, the tag at 40, the excerpt at 200 characters of the element, control characters
(and `"` and `\` in a device or name) escaped, and a BLOB payload is never in it. The same problem (consequence, tag, device, name,
reason) is logged once a minute; repeats are counted and added to the next line as "(N more since the last line)".
All problems together are capped at 20 lines a minute, and the repeat check holds at most 256 keys.

## Recording

The tap sits after the framer and gets every element's wire text as before, bad ones included, and now also when an
element earlier or later in the same chunk is bad (before, a throw lost the whole chunk from the recording). A BLOB
payload is kept whether or not its vector validates: a bad `setBLOBVector` is elided and its payloads are decoded
from the bytes, in the same order as for a good one. Limit:
the recording stores text, so invalid UTF-8 bytes in an element are recorded as U+FFFD, and the unfinished bytes
of an element at a dropped connection are not recorded.

## Cases

Each row is a test in `bad-input.test.ts`. "Before" is a182aac.

| Input | Before | Now |
| --- | --- | --- |
| No `device` attribute | Throw, connection dropped | Skipped, logged |
| Empty `device` or `name` (property or element) | Accepted as a property named "" | Skipped, logged |
| Unknown element type (`<bogus/>`, `<defFooVector>`) | Ignored silently | Skipped, logged. `<message>` stays silent |
| Truncated before its close tag, next element follows | Swallowed the following elements, then a throw and a dropped connection | Connection dropped, logged, elements before it kept |
| Truncated at the end of the stream | Held in the buffer | Same; nothing is logged |
| Huge element | Waits to 512 MB, then throw | Dropped, logged, over 8 MB, whether it arrives whole or in small chunks. A BLOB vector keeps 512 MB. A tag or comment that never ends is held to the same 8 MB |
| Invalid UTF-8 | Replacement characters, no error | Same, in a bad element's device and name too. Marked `not valid UTF-8` in the log when the element is bad |
| Number with junk text (`12abc`, `nan`) | Throw, connection dropped | Whole vector skipped, property forgotten, logged |
| Unknown vector `state`, `perm` or light state | Throw, connection dropped | Skipped, property forgotten, logged |
| Unknown switch value (not `On` or `Off`) | Read as Off | Skipped, property forgotten, logged |
| Unknown switch `rule` | Not read, accepted | Same: Cria does not use `rule` |

## Not done

Surfacing the counter on the wire (it is in the log only); recording invalid UTF-8 byte for byte; resyncing after a
bad element that names no property.
