# Cria on Linux: TypeScript, INDI and Effect

The rules of the TypeScript Cria under `ts/`, and why each one exists. The wire
is `@cria/wire` and the golden (`ts/testing/golden/wire.golden.json`); those are
enforced, so this file does not repeat them. Where this file and the code
disagree on a rule, one of them has a bug: find out which.

## What this is

Cria is an INDI client. It is a TypeScript service that connects to
`indiserver` on TCP 7624, reads INDI properties as Readings for the commands that need them, runs one bounded
operation at a time per device, and serves its clients over HTTP (wire
protocol 5). Clients read the rig itself from the rig stream (NATS, JetStream `RIG_DEV`: the drivers' INDI traffic plus Cria's `cria.request`, `cria.settled`, `cria.write` and `cria.frame` entries). Cria keeps no client-facing picture of the rig. INDI runs one process per driver, and those processes are the
isolation boundary: Cria sees a driver crash as the device's properties
disappearing.

```
Vela server ──HTTP (protocol 5)──▶ Cria (Node, Effect) ──INDI XML/TCP──▶ indiserver ──▶ one process per driver ──▶ devices
```

Cria says one thing to one device and tells the truth about what happened. The
client owns runs, decisions, processing and archives. Images are a rolling set. An uncertain outcome on any device, the mount included, settles `uncertain` and holds nothing: the next command is accepted. Cria never resends a command blindly.

## The layers

The code follows primitives.md's four layers. Each layer imports only from the
layers above it in this list.

1. **Types** (`@cria/primitives`). `Outcome` and `Reading`. The wire schemas in
   `@cria/wire` are Views: one Effect Schema gives the type and the validator.
2. **Disciplines** (`@cria/primitives`). `writeOnce`, `confirm`, `stoppable`,
   They encode "no blind replay" and
   "honest state" once, so capabilities do not each derive them again.
3. **Capabilities** (`apps/cria/src/capability`). Camera, mount, focuser,
   box (the Pegasus power box) and connection. Each is an INDI device seen through the
   disciplines. A command reads the Readings it needs and returns an Outcome.
   Capabilities never see XML or sockets. They see `IndiDevice` (properties,
   states, `send`) behind the INDI boundary.
4. **Workflows run by the ledger** (`apps/cria/src/operation`). Each wire operation kind
   (`capture`, `focuser-move`, `mount-slew`, and the others) is a short workflow
   body over one capability. The ledger (`ledger.ts`, one per rig) admits it, runs
   it as one fiber, reports its progress, stops it by interruption, and settles it
   with an Outcome.

Two boundaries sit around the layers and map to no primitive on purpose:

- **INDI boundary** (`@cria/indi`). XML framing and parsing, the TCP connection,
  and the property mirror. This adapter absorbs protocol irregularity so nothing
  above it has to.
- **Wire boundary** (`apps/cria/src/wire`). The HTTP routes, which answer with the
  ledger's operations as protocol 5 JSON, typed by `@cria/wire`.

The image store (`apps/cria/src/image`) keeps the camera's FITS in a
rolling set. It is domain storage, not a primitive.

## Effect decisions

- Outcome is the error channel. A command is `Effect<A, Failed | Stopped | Uncertain>`.
  `confirmed` is the success value, and the three tagged errors are the other
  endings. `yield*` unwraps, so a workflow body reads as the happy path, and an
  uncertain outcome cannot be dropped. It ends the run unless code matches it by
  tag.
- Transport faults and bugs are not Outcomes. They are defects, or `IndiError`
  inside the INDI boundary. The disciplines turn them into an Outcome where they
  know what the fault means. Before a write it is `failed`, and after a write it
  is `uncertain`.
- `settle(effect)` is the one place that turns an Effect into the plain
  `Outcome<A>` union. When a cause carries several endings, the precedence is
  uncertain, then failed, then stopped, then confirmed. For example, an
  interrupted run whose stop could not be confirmed is `uncertain`, not `stopped`.
- No blanket catch. `testing/lint.test.ts` fails if `Effect.catch`, `catchCause`,
  `ignore`, `orElse*`, `option`, `exit` or `result` appear outside the files
  allowed to settle, each with a counted, written reason. The same test counts
  `try`, `.catch(`, `Date.now()` and Node timers per file.
- `stoppable` runs its stop command uninterruptibly with its own timeout.
- Dependencies are plain arguments, built in one composition file (`rig.ts`,
  called from `service.ts`). There is no `Context` service graph and there are no
  Layers for app code. Vela's standards ask for visible construction, and a
  service container would hide which capability talks to which device. Effect is
  used for effects, errors, fibers, scopes, schedules and schemas.

## Primitives

### Outcome

```ts
type Outcome<A> =
  | { kind: 'confirmed'; value: A }
  | { kind: 'failed'; reason: FailedReason; message: string }      // known not to have taken effect
  | { kind: 'stopped' }                                            // cancellation confirmed
  | { kind: 'uncertain'; reason: UncertainReason; message: string } // may have taken effect

type FailedReason = 'busy' | 'disconnected' | 'unsupported' | 'rejected' | 'invalid' | 'unavailable'
type UncertainReason = 'no-acknowledgement' | 'not-confirmed' | 'stop-not-confirmed' | 'connection-lost' | 'driver-lost' | 'unexpected-error'
```

`reason` is a closed union, with a `message` for people. A free string would let a
new reason appear without anyone matching it. A defect (a bug) is
`uncertain: unexpected-error`, never `failed`. The package exports the lists as
values (`failedReasons`, `uncertainReasons`), and `@cria/wire` builds its schemas
from them.

### Reading

```ts
type Reading<T> =
  | { status: 'fresh'; value: T; observedAt: number }
  | { status: 'stale'; value: T; observedAt: number }
  | { status: 'unavailable'; reason: 'not-read' | 'unsupported' | 'failed'; message?: string }
```

`unavailable` carries a closed reason: "this device does not have this"
(`unsupported`) is kept apart from "this read failed" (`failed`). Times are epoch
milliseconds. Readings stay inside Cria, for the commands that check a fact
before sending; no route returns them.

`Reading.required(reading, what)` is the fresh-or-fail step a command starts
with. It returns `Effect<T, Failed>`: the value of a fresh Reading, `failed:
unsupported` for `unavailable: unsupported`, and `failed: unavailable` for every
other Reading that is not fresh (stale, not read, failed). `what` names the fact
in the message.

**What fresh means on INDI.** INDI drivers poll their own hardware and push
changes, and don't send an unchanged value again. Cria doesn't judge how recent a
value is: `observedAt` is when the driver last reported it, and a reader decides
whether that's recent enough (Chris, 2026-11-05: "alive" isn't a real state). A
value is fresh when the INDI connection is up, the driver hasn't removed the device
and the property is not in `Alert`. A property in `Alert`, a removed device or a
lost connection makes the affected values stale (value kept, age kept). A missing
property is `unavailable: unsupported` once the device's
definitions are complete.

**Alert has two meanings.** On telemetry (a temperature) `Alert` means the read
failed, so the value is stale. On a command property (`CCD_EXPOSURE` after an
abort, a focuser position after a failed move, the mount's coordinates after a
failed slew) it means the last command failed while the value is still good. Each
Reading says which kind its property is (`alertMeansStale: false` for command
properties).

### Disciplines

All three are functions in `@cria/primitives`, generic over the device. They take
small Effects (send, read, stop) and know nothing of INDI.

**`writeOnce({ send, acknowledged })`.** Sends a command exactly once and
classifies the driver's first answer, as this table shows.

| Situation | Outcome | Why |
|---|---|---|
| A precondition fails before sending (not writable, already busy, disconnected) | `failed` | Nothing was sent. |
| The transport is down before sending | `failed: unavailable` | Nothing was sent. |
| The socket write fails, or the connection drops after sending | `uncertain: connection-lost` | The bytes may have reached the driver. |
| The driver answers `Alert` without having gone `Busy` | `failed: rejected` | INDI drivers refuse a bad request by setting `Alert` at once. An `Alert` already present before the send is not a rejection. |
| The driver answers `Ok`, `Idle` or `Busy` | acknowledged; `confirm` or `stoppable` continues | The driver accepted the command. Acknowledged is not confirmed. |
| An axis motion (`TELESCOPE_MOTION_WE`) start gets an `Idle` or `Ok` update, received after the send, that shows the requested switch still Off | `failed: rejected`, "the driver answered Idle and did not start MOTION_EAST (it stayed Off)"; nothing is stopped | The driver answered, and what it answered is that it did not start (errai's AM5 at Home answered in 41 ms, 2026-10-30; nothing moved). An update received before the send never counts, and a routine update that echoes the requested switch On is ignored like any routine update. Only axis motion starts, where a driver always answers Busy. |
| A motion (slew, focuser move, exposure) gets a routine `Ok` update | ignored; keep waiting | Drivers send polled properties again several times a second. Only `Busy`, `Alert` or an update at the target answers a motion. |
| A number setting settles at a different value than asked (a ZWO gain rounded to the driver's step) | `failed: rejected`, with the value the driver chose | The device state is known, so this is not uncertainty. A value within half the element's step of the request is the request applied (the PPBA holds 10 % duty as 9.8039 %); the switch channel reports the value the driver holds. |
| No answer before the acknowledgement deadline | `uncertain: no-acknowledgement` | It may be running. Cria never resends it. |

`writeOnce` has no retry parameter, so replay cannot be configured. The send
shares the acknowledgement deadline, so a stalled socket cannot hold a stop or a
shutdown.

**A stop or abort may be resent. A motion or setting never is.** An abort can only
stop motion, never start it, so sending it twice cannot cause anything one abort
would not. Sending a motion or setting again when its outcome is unknown could
move or change the equipment a second time. Inside `stoppable`, a stop that fails
(indiserver unreachable, no acknowledgement) is tried again every 500 ms until
`stopWithin`.

**`confirm({ read, holds, within })`.** After an acknowledged write, reads until the
observed state satisfies the target or the deadline passes. If it holds, the
result is `confirmed` with the observed value. At the deadline it is
`uncertain: not-confirmed`. A read error during confirm is retried at the read
pace, because reads are safe. The write is never retried. `writeConfirmed` is
`writeOnce` plus `confirm` as one uninterruptible step.

**`stoppable({ start, settle, stop, stopWithin })`.** For anything that moves or
exposes. `start` is a `writeOnce`. `settle` waits for completion and is the only
interruptible part. If the fiber is interrupted (Vela cancelled) or `settle` fails
while the device is in motion, `stop` runs uninterruptibly with its own timeout
and must confirm the device is stationary. A confirmed stop gives `stopped` (or
the original `failed`). A stop that is not confirmed gives
`uncertain: stop-not-confirmed`, or keeps an earlier uncertain reason such as
`driver-lost` with "stop was not confirmed" added. A cancel that arrives before
the motion is sent is honoured at the start of `stoppable`. The motion is never
sent, and the run ends `stopped`. Work with no physical side effect left (writing a
finished frame) is outside `settle`.

**After a motion starts, nothing is `failed`.** Once a motion's start is
acknowledged, an ending that is not confirmed (Alert part-way, a deadline, a stale
reading during a rotate, settling outside the target tolerance) is `uncertain`,
because the device moved by an unknown amount. The one opt-out is a camera
exposure (`settleFailure: 'failed'`). With the abort confirmed the camera is idle
and nothing persists, so an exposure error leaves the camera free.

## The ledger

`apps/cria/src/operation/ledger.ts` is the one owner of operations, per rig. It
holds one immutable state in a `Ref`. Each transition (admit, progress, settle,
cancel, prune) is a pure function that returns the new
state and the effects to run after it (start an operation, stop one).

Each operation runs as one fiber, keyed by its ID. The work is uninterruptible
except inside `stoppable`'s wait, and the outcome comes from the body's own exit.
So a cancel during a setting, or after a motion finished, reports what really
happened (`confirmed`), and `stopped` means nothing physical happened or a stop
confirmed it. Only the ledger starts work, and only once it has admitted the
operation, so nothing else can find a device busy.

An uncertain ending on any device kind holds nothing and is pruned like any
settled operation.

### Admission

`POST /v2/operations` checks, in this order:

1. A known request ID with the same content returns the same operation. Other
   content is `409 request-conflict`. A request whose operation was pruned is
   `410 result-expired`.
2. `instanceId` is not this Cria's: `409 instance-changed`.
3. An unknown device: `400 request-error`.
4. A kind for another device kind: `400 request-error`.
5. Commands disabled in the config: `403 commands-disabled`.
6. A halt (`mount-stop`, `focuser-halt`) is admitted now (see below).
7. An open operation on the device: `409 device-busy`.

Otherwise the operation starts at once, as `running`. A motion or setting is
never queued. Admission and the start happen in one step, so nothing else is
admitted between them.

### Halts, stops and cancel

On an idle device a halt starts at once. On a busy
device it is `waiting`, and if the running operation is not itself a halt, the
ledger stops it (its own `stoppable` halts and confirms). When an
operation settles, the oldest waiting halt starts in the same step.

So a repeated stop waits its turn and runs, sending the abort again, and settles
`confirmed` like the first. Two stops queued behind one slew both run in turn.

`POST /v2/operations/{id}/cancel` returns the operation as it is now (`202`). For a
running operation that is not a halt, it also stops it; the outcome
says what happened. A halt, waiting or running, is returned unchanged and still
runs. A stop is never cancelled. Cancelling a settled operation returns it
unchanged.

Cancel of an operation ID Cria does not hold answers an error and cancels
nothing: `404 not-found` for an ID it never held, `410 result-expired` for one it
pruned (its request ID is still known). Both mean there is nothing to cancel, and
`GET /v2/operations/{id}` answers the same two.

### Settle bounds

Every running operation settles in bounded time. The bound is in Cria's
configuration and in the code of its kind, and the wire does not carry it: an
operation has no deadline field, and Vela cannot read the configured values.

| Operation | Bound |
|---|---|
| Capture | None. A capture ends on its frame, an Alert, a lost driver or connection, or a cancel. A client that sees the camera has stopped counting cancels it. |
| Motion (slew, home, focuser move) | `operationTimeoutMs` for the driver to finish the motion, then `failed: unavailable`. |
| Setting | `acknowledgeMs` for the driver to answer, then `confirmMs` (15 s) for the new state; `uncertain` if either passes. |
| Stop (`mount-stop`, `focuser-halt`) and a cancelled operation's stop | `acknowledgeMs` plus `confirmMs` (20 s). A stop is confirmed from the position, not from any property's state (see "Stopping the mount"). |
| `device-connect` | `connectTimeoutMs` for the driver to acknowledge the connect and again for the device to read connected, then `uncertain`. Device setup follows under its own writes' bounds. |

These bounds are per kind, not one guarantee stated in code: nothing enforces a
single limit across kinds, and a kind added later needs its own. A person's Stop
is available whatever the bound.

### What the ledger keeps

The ledger keeps the newest `operationHistory` settled operations (config, default
1000).

## Module map

Every source file starts with a doc comment that names what it is (a primitive,
a capability, the wire boundary, composition). `rig.ts` is the one place that
shows what is connected to what. `ts/README.md` has the layout of the packages
and `docs/testing.md` the tests.

## The INDI boundary

What crosses it:

- **Out.** One `IndiDevice` per INDI device name. It has `property(name)` (a typed
  snapshot: kind, state `Idle|Ok|Busy|Alert`, permission, elements with values and
  number limits, `receivedAt`), a stream of changes, `send(name, values)` (one
  `new*Vector`, which returns when written to the socket), a one-off read,
  BLOBs while enabled, and whether the definitions are complete.
- **Never out.** XML, sockets, base64, the `getProperties` exchange, entity
  decoding.

Behaviour inside the boundary:

- One TCP connection to `indiserver` (default `127.0.0.1:7624`). On connect it
  sends `getProperties version="1.7"`. Reconnect is paced, 250 ms doubling to 5 s,
  and the delay resets after 10 s connected. A lost connection marks every
  property stale and fails every pending `send` as `connection-lost`. It never
  resends.
- The framer reads top-level elements straight from bytes. It decodes BLOB
  payloads (about 70 MB of base64 for a 2600 frame) from the byte buffer without
  building intermediate strings per chunk. Text values are trimmed (indiserver
  sends `"\nRGGB\n    "`).
- An element Cria cannot read never ends the connection by itself: it is skipped and logged, and the property it was
  about is forgotten until the driver defines it again. Only lost framing drops the connection. See
  [indi-bad-input.md](indi-bad-input.md).
- `delProperty` without a name (driver gone or device removed) clears the device.
  Every reading a command needs is unavailable, and its in-flight command ends
  uncertain.
- A one-off read is `getProperties device=X name=Y`. The driver answers with that
  one definition (checked against libindi 2.2.5), and INDI forwards the answer to
  every client of the device. Only a mount's stop check uses it, while the mount
  is moving.
- Cria enables BLOBs for a camera only around its own capture (`enableBLOB Also`
  before the exposure, `Never` after), so PHD2's guide frames do not flow through
  Cria. A capture takes only a `CCD1` BLOB that arrives after its own `Busy` and
  whose FITS `EXPTIME` (the commanded time; the camera minimum for a bias, see
  "Capture frame type"), size and `DATE-OBS` (within 0.5 s) match. Any
  other frame is skipped and logged, and the capture keeps waiting.
- A capture has no deadline of its own. The camera's Alert ends it, and it stays open otherwise, so a hung camera holds the device until a client cancels the operation. The client decides from what it sees on the stream.

### INDI properties a command reads

Standard INDI names, so the simulators and the rig drivers share them. Where the
real drivers differ, the table lists both, and the first one present wins. A
command reads only the facts it needs, and refuses before sending when one is not
fresh.

| Fact | INDI property and element | Used by | Notes |
|---|---|---|---|
| camera activity | `CCD_EXPOSURE` state | `capture`, `camera-configure` | `Busy` is `exposing`, else `idle` |
| camera exposure range | `CCD_EXPOSURE.CCD_EXPOSURE_VALUE` min and max | `capture` | |
| camera geometry | `CCD_FRAME` | `capture` | `WIDTH` and `HEIGHT`, read directly |
| camera gain and offset ranges | `CCD_GAIN.GAIN` or `CCD_CONTROLS.Gain`; `CCD_OFFSET.OFFSET` or `CCD_CONTROLS.Offset` | `camera-configure` | The ZWO driver uses `CCD_CONTROLS` |
| camera `bayerPattern` | `CCD_CFA` (`CFA_OFFSET_X`, `CFA_OFFSET_Y`, `CFA_TYPE`, all text) | `capture` | `mono` without `CCD_CFA`; the CFA offset shifts the pattern |
| mount RA, Dec | `EQUATORIAL_EOD_COORD.RA/DEC`, else `EQUATORIAL_COORD` | `mount-slew`, `mount-axis`, `mount-rotate` | The frame is `topocentric` (JNow) for the first, `j2000` for the second. Cria never converts frames. |
| mount slewing | the coordinates property's state is `Busy` | `mount-slew`, `mount-axis`, `mount-rotate`, `mount-home` | |
| mount axis rates | `TELESCOPE_SLEW_RATE` | `mount-axis`, `mount-rotate` | Named rates with degrees per second, parsed from the labels: the AM5 names them `1x` to `10x` but labels them with the true multiples `0.25x` to `1440x` |
| focuser | `ABS_FOCUS_POSITION`, `FOCUS_MAX`, `FOCUS_ABORT_MOTION` | `focuser-move`, `focuser-halt` | Moving is the position `Busy`; the top is the smaller of `FOCUS_MAX` and the position's maximum; the travel window narrows it (see "The focuser travel window") |
| box channel | the configured `property.element` list | `switch-set` | For example `POWER_CHANNELS.POWER_CHANNEL_1` (12 V master). Its range, step and writability come from the property's definition. |

Commands use the same properties: exposure `CCD_EXPOSURE`, abort
`CCD_ABORT_EXPOSURE`, cooler `CCD_COOLER` and `CCD_TEMPERATURE`, slew
`ON_COORD_SET=TRACK` then the coordinates, stop `TELESCOPE_ABORT_MOTION`, home `TELESCOPE_HOME.GO`, axis motion `TELESCOPE_MOTION_WE` and
`TELESCOPE_SLEW_RATE`, focuser `ABS_FOCUS_POSITION` and `FOCUS_ABORT_MOTION`,
connect `CONNECTION`.

INDI conventions Cria depends on:

- **`Busy` is not uniform.** `TELESCOPE_TRACK_STATE` stays `Busy` while tracking
  is engaged, and `CONNECTION` is `Busy` only while connecting. So each switch
  setting's confirmation says what "settled" means for that property
  (`switchConfirmed(…, holds)`).
- **A motion's answer.** A polled property (the mount's coordinates, four times a
  second on the simulator) can push a routine update just after a send. Motions
  are acknowledged only by `Busy`, `Alert`, or an update that shows the target
  already reached (`startMotion(…, { arrived })`). The focuser simulator finishes a
  short move without going `Busy`.
- **A mount stop is confirmed** when none of `EQUATORIAL_EOD_COORD`,
  `EQUATORIAL_COORD`, `TELESCOPE_HOME`, `TELESCOPE_MOTION_WE` and
  `TELESCOPE_MOTION_NS` is `Busy`, and the mount stands still (see "Stopping the
  mount"). The state alone is not enough: the AM5 goes `Idle` at once and coasts.
- **A cooling setpoint is confirmed** only by `Busy` (regulating) or `Ok` at the
  setpoint, not by a routine temperature update.
- **No manual duty under auto dew.** While a switch channel's `automaticWhileOn`
  channel is on, Cria refuses a `switch-set` on it as `failed: invalid` before
  sending, naming the channel to switch off first. The PPBA accepts a manual dew
  duty under auto dew and sets it back to 0 within seconds, so a confirmed write
  would be a lie. Which channel governs which is configuration, not code.
- **Axis motion** runs only at a rate the mount advertises (within 1 %). A rotate
  whose rate and distance signs differ is refused. A rotate leads its stop (see
  "Stopping the mount"), and `mount-axis` and `mount-rotate` report
  `travelledDegrees`, the RA travelled from the start to where the mount stood
  still, east positive.

### Stopping the mount

The AM5 acknowledges a stop long before it is stationary. Measured on errai on
2026-10-15: a cancelled slew at about 3°/s went `Idle` at
once and moved 3.6° more over 2 s, and an 8x rotate (0.2507°/s) overshot by its
rate times 0.9 s. A goto ends `Ok`, a rate move with tracking on never reports
`Idle`, and a home reports `Idle` from its first reading and moves for 12 s. So no
property state says the mount stopped, and Cria has one definition of "stopped"
(`capability/stopped.ts`), used by every motion:

> The mount has stopped when readings that arrived after the command show its
> position no longer changing.

Each reading is a definition the driver sends again (`getProperties` for the
coordinates), `positionReadMs` apart (1.5 s). The mount
has stopped when the newest reading and an earlier one at least that window before
it, and every reading between them, differ by at most `stationaryDegrees` (0.02°)
on each axis. Which readings count:

1. Only readings that arrived after Cria began sending the command. Nothing read
   before it can show that it worked.
2. A reading in the first window after the command that repeats the position the
   mirror held when the command went out is dropped. It may be the driver's cache
   of its last poll, and a mount that was moving cannot read the same twice. After
   that window the driver has polled again and the same position is where the
   mount is. A mount that was already still therefore takes one more read to
   confirm.
3. Idle and Ok say nothing, and neither does `Busy` on any property, including
   `TELESCOPE_HOME`, which indi_lx200am5 leaves `Busy` for good after a home it has
   stopped (errai, 2026-10-26: no further update of it in 25 s, the coordinates
   `Idle` and unmoved).

Reads, not pushed updates: INDI publishes a position only when it moves by more
than 0.1 arcsecond (libindi 2.2.5, `Telescope::NewRaDec`), so a still mount that
tracks publishes nothing, and the same update read twice would prove nothing.
1.5 s is longer than indi_lx200am5's 1 s poll of the mount, so two reads straddle
at least one poll. Each axis, not the angle on the sky: at the pole a turning RA
axis barely moves the pointing.

Where it is used:

| Motion | The command | Done when |
|---|---|---|
| `mount-stop`, and a cancelled slew or home | `TELESCOPE_ABORT_MOTION` | the position has stopped |
| `mount-axis` and `mount-rotate` halt | `TELESCOPE_MOTION_WE` both off | the position has stopped |
| `mount-slew`, `mount-home` | the motion itself | the property leaves `Busy` (the driver says it is over), then the position has stopped since the motion was sent |

A slew then compares where it stopped with the target: within 0.1° of it, and it
is confirmed; elsewhere, `uncertain: not-confirmed`. That tolerance says where the
slew landed, not whether the mount stopped.

The tolerance and the sidereal drift. With tracking off the mount stands still
against the ground and its RA advances 15.04 arcseconds a second (0.0042°/s), so
two reads 1.5 s apart differ by 0.0063° in RA. With tracking on the coordinates
hold still. 0.02° is three times that drift and far below coasting (the measured
tail moved 0.17° in its last second), so Cria compares the axes without removing
the drift. Still means within that tolerance, not unchanged: a mount drifting
under it is accepted as stopped (0.01°/s is 0.015° over the 1.5 s between reads;
a synthetic probe, not seen on the rig).

The stop is bounded by `acknowledgeMs` plus `confirmMs` (20 s): inside `stoppable` the abort is sent
again until the position has stopped or the 20 s pass, and `mount-stop` gives up at
20 s. A stop or abort is the only command that is ever resent: it can only stop
motion, never start it. Unconfirmed, the outcome is `uncertain: stop-not-confirmed`,
never `confirmed`. This covers `mount-stop`, cancelling a slew, home,
`mount-axis` or `mount-rotate`, and SIGTERM. A home that a client stopped
and whose property stays `Busy` is stopped when its position has stopped, and the
mount is `stopped`; one whose position keeps changing stays `uncertain`,
as does one whose position cannot be read.

Starting a home, slew, `mount-axis` or `mount-rotate` is refused as busy
only when the coordinates are `Busy`.

**A rotate uses a fast leg and a slow approach.** `mount-rotate` keeps its
request and outcome shape. One operation covers both legs. Cancel and
`mount-stop` apply throughout, including the confirmed stop between legs.

For a distance larger than the approach window, the first leg uses the
requested advertised rate until travel reaches distance minus the window.
The window is that rate's expected coast plus rate times `positionReadMs`
plus 0.25°. Cria then halts and confirms the stop with the
existing position rule. The approach uses the slowest advertised primary-axis
rate of at least 0.1°/s, in the requested direction, for the remaining distance.
It leads its stop by that rate's expected coast and confirms the stop again.
The requested rate is a ceiling for every leg. A near-match advertised rate
above that ceiling is refused before any command. If it is at or below the
approach rate, the entire move uses one leg at the requested rate.
A small request at a higher rate uses only the approach. Remaining travel below the approach
coast needs no second leg. There is no third correction.

Expected coast starts at 4,084 arcseconds for the step-3 3.008°/s rate and
54 arcseconds for 0.2507°/s. Other advertised rates use rate times the configured
`stopLatencyMs` as their seed. After each confirmed axis halt, Cria retains the
last nine measured coasts for that rate and uses their median, clamped to
0.5 to 2 times the seed. Estimates live only in this Cria session and reset
on restart.

The motion record retains the full request and total observed travel. Rate
motion travel starts at the position held just before the command. Its
`legs` lists each axis motion it ran, with its command, travel, stop and
measured `coastDegrees`. Any axis motion records `coastDegrees`. The coast
estimate lives in `capability/rotate.ts`, beside the rotate it serves.
The outcome's `travelledDegrees` remains the measured total in either direction.

### Device setup

Some devices need settings written before they can do their work, and nothing
else on the rig writes them. Device setup is a closed table of steps per device
kind (`capability/setup.ts`). Each step plans one write from the device's
readings and the config, or says why it writes nothing, and a write is a
`writeOnce` plus a `confirm`: never resent. Steps run in order and stop at the
first that does not confirm.

| Kind | Step | Writes | Nothing written when |
|---|---|---|---|
| camera | frames to Cria | `UPLOAD_MODE` `UPLOAD_CLIENT=On`, confirmed by readback | `UPLOAD_LOCAL` is already off, or the camera has no `UPLOAD_MODE` |
| mount | driver debug, when the device's `driverDebug` is true | `DEBUG` `ENABLE=On`, then `DEBUG_LEVEL` `DBG_DEBUG=On` once the driver defines it, confirmed by readback | Not asked for, the driver has no `DEBUG`, or both are already on |
| mount | site | `GEOGRAPHIC_COORD` `LAT`, `LONG` (0 to 360 east), `ELEV` from the device's `site`, confirmed by the driver's echo (`numbersApplied`) | no `site` configured or the mount has no `GEOGRAPHIC_COORD` |
| mount | time, after the site | `TIME_UTC` `UTC` from the system clock (`YYYY-MM-DDTHH:MM:SS`), `OFFSET=0.00`, confirmed by the echoed `UTC` | the mount has no `TIME_UTC` |

Why each step exists:

- **Frames to Cria.** A camera on `UPLOAD_LOCAL` saves frames on the rig's disk
  and sends Cria nothing, so captures were refused. errai's 2600 was on local.
- **Driver debug.** It's how the mount's raw status replies reach the rig stream, and it doesn't survive a driver restart or a power cut (Chris, 2026-11-05), so Cria sets it each time a device is set up.
- **Site, then time.** The AM5 refuses every goto until its site and time are
  set after it powers on. It answers `:MS#` with `e7#` ("time and site not
  synchronized"). In indi_lx200am5 the `GEOGRAPHIC_COORD` write sends `:Sg` then
  `:St`, and the `TIME_UTC` write sends `:SG`, `:SL` and `:SC` (libindi 2.2.5
  source). The raw sequence `:St`, `:Sg`, `:SG`, `:SC`, `:SL` made the mount
  accept gotos on errai. The time uses offset 0, so the mount's local time is UTC
  and the two agree. Always write both, even when the driver reports the configured
  site. After a power-on the driver can report stored values while the AM5 still
  needs the writes. The two INDI writes cleared a real power-on refusal on
  2026-11-03; reporting matching values alone did not.

**When it runs.** Only when someone asks. Cria never sets a device up by
itself, in the same way that it never connects a device by itself. A device is
set up by `device-connect` with `connected: true`, which connects the device if
it is not connected and then runs the setup steps, in one operation that goes
through the ledger like any other. That makes it single-flight with Vela's
operations. A device with steps whose connection has not been set up yet is
`starting`, which Cria tracks for its own commands (a goto on such a mount
refuses with advice). A connection ends when the device disconnects, its
driver goes away (`delProperty` without a name) or the indiserver connection is
lost, and the next connection is `starting` again. A device with no steps
(a focuser, a box) is never `starting`. A setup that ran is not run again until
the connection ends, or someone sends `device-connect` with `connected: true`
again, which always runs the setup steps. With commands disabled, nothing runs.

On the rig the supervisor is the one that asks: it sends the `device-connect`
for a device that is disconnected, or connected but not set up in this Cria instance (docs/runtime.md, rule b),
within about two polls, roughly 10 s, of the hardware being present and nothing
being open on the device. Another client of the API (Vela, a test) can send it
sooner.

**What it reports.** The `device-connect` outcome's values carry
`setup`, one string of what each step did, for example
`sent GEOGRAPHIC_COORD LAT=33.45 LONG=247.93 ELEV=331; sent TIME_UTC UTC=2026-10-16T00:21:47 OFFSET=0.00`
or `UPLOAD_MODE already sends frames to Cria`. Setup steps cannot move equipment. An unconfirmed or refused setup
write ends `failed`, names the step, and leaves the device ready.
Setup stops at that step and does not retry automatically. Commands that can
move equipment keep their existing uncertain outcome.

**A refused goto says what to do.** A goto rejected before motion starts ends
`failed: rejected`. Its message says nothing moved, that an AM5 refuses gotos
until its site and time are set after power-on (AM5 e7), what setup did on this
connection, and to send `device-connect` with `connected: true` to send them
again. Cria never retries the goto or resends setup as part of a refusal.
INDI's `Alert` alone does not prove e7, so the message gives it even when setup
confirmed.

### The focuser travel window

A focuser's driver range is not the range that is safe for the hardware. On
errai the EAF's `FOCUS_MAX` is 100000 (a user setting), `ABS_FOCUS_POSITION`
allows 0 to 60000, and the focus tube is already far out at 32749: Chris chose
15500 to 38000 as the safe range (2026-10-15). So a focuser has an optional
`travel: { min, max }` in the config (see "Configuration"), and errai's EAF has
15500 to 38000. Cria never writes `FOCUS_MAX`; the window lives in Cria.

**The usable window.** The top is the smallest of `FOCUS_MAX` (when the driver
defines it), the position's own maximum and `travel.max`; the bottom is the
larger of the position's own minimum and `travel.min`. Without a window they are
the driver's range, and the top never exceeds what the position accepts. A move is
checked against this window before anything is sent.

**Without a window, or with a window as high as the driver's top**, the top is
the driver's top itself, and that value is not a usable target: the first refusal
below (`approaches the mechanical limit`) refuses a target at or past the
driver's top, so the highest target that is allowed is one step below it. "Both
ends allowed" holds for a configured `travel.max` below the driver's top, such as
errai's 38000, and for the bottom always. A focuser with no window and a
client that targets the driver's top is refused `failed: invalid`; keep one step of
margin below it when no window is configured. The limits come from the property's definition, so
an `Alert` on the position (a refused move) does not make them, or `absolute`,
stale; otherwise every move after a refused one would fail `unavailable`.

**What Cria refuses**, as `failed: invalid` before sending anything:

- a target at or past the driver's top (the smaller of `FOCUS_MAX` and the
  position's maximum): `Focuser target approaches the mechanical limit`. On
  errai that covers 60000 to 100000, which `FOCUS_MAX` alone would let through
  to a driver that refuses it;
- a target outside the travel window, both ends allowed:
  `Focuser target 38001 is outside the travel window 15500..38000`;
- when the focuser already stands outside the window (moved by hand or by
  another client), a target outside the window that is not between the
  focuser and the window:
  `Focuser target 9000 is outside the travel window 15500..38000 and the focuser is at 10000: only a move toward the window is allowed`.
  A move toward the window, or into it, is allowed, so the focuser can be
  brought back without editing the config. A move past the far end is refused.

A halt (`focuser-halt`) is never checked against the window. `focuser-move` is
absolute on the wire and Cria sends only `ABS_FOCUS_POSITION`, so a relative
move is Vela's arithmetic and is checked on its resulting target. Cria does not
check the driver's minimum: the wire's smallest target is 1 and the EAF's
minimum is 0, and a driver with a higher minimum refuses the move itself
(`failed: rejected`, nothing moves).

**No mid-move guard.** The EAF is a stepper driven to an absolute target, and
its backlash compensation is off on errai (`FOCUS_BACKLASH_TOGGLE` disabled,
`FOCUS_BACKLASH_STEPS` 0), so a move does not pass its target. If backlash
compensation is turned on, a move can overshoot by up to the backlash steps:
keep the window that far inside the hardware's real limits. Another INDI client
(the EAF's presets, a hand controller) can still move the focuser anywhere in
the driver's range; the window guards only Cria's moves.

## The wire (protocol 5)

The single definition of the wire is the Effect Schema package `ts/packages/cria-wire`
(`@cria/wire`). Cria builds every response from it and validates every request
with it (unknown keys refused). Vela imports the same package, so the two agree by
construction. The routes keep the `/v2` prefix. `protocolVersion` is the version
signal, and Vela refuses any value but 5.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | `{ status: 'ok', protocolVersion: 5, instanceId, commandsEnabled }`. A client takes the `instanceId` for its requests from here. |
| `POST /v2/operations` | `OperationRequest`, answered `202` with the `Operation` (see "Admission"). |
| `GET /v2/operations/{id}` | `Operation`, `404 not-found`, or `410 result-expired`. |
| `GET /v2/requests/{instance}/{request}` | The operation for a request ID, for a lost POST response. `404 not-found` if unknown. |
| `POST /v2/operations/{id}/cancel` | `202` with the `Operation`; `404 not-found` for an unknown ID, `410 result-expired` for a pruned one (see "Halts, stops and cancel"). |
| `GET /v2/images/{id}/original` | The camera's FITS as delivered (`application/fits`), with an exact `content-length` and `ETag` = SHA-256. `410 image-gone` for an image ID Cria no longer holds or never held. `404 not-found` for a path segment that is not an image ID. |

A request with an `Origin` header is refused, so a browser cannot call Cria. Request bodies are limited in size.

### Errors

An error is `{ error: { code, message }, instanceId }`. `code` is one of the
closed `errorCodes` list, and each code has exactly one HTTP status:

| Status | Codes |
|---|---|
| 400 | `request-error` |
| 403 | `origin-rejected`, `commands-disabled` |
| 404 | `not-found` |
| 409 | `request-conflict`, `instance-changed`, `device-busy` |
| 410 | `result-expired`, `image-gone` |
| 413 | `request-too-large` |
| 500 | `internal-error` |

### The rig

Cria has no route that returns the rig's state. A client reads the rig from the
rig stream: the drivers' own INDI traffic, with Cria's `cria.request`,
`cria.settled`, `cria.write` and `cria.frame` entries beside it. What Cria alone
answers is whether a command was accepted, what became of it, and the image it
made. `instanceId` is new on every Cria start, so everything in flight before it
is unknown.

When commands are disabled (`commandsEnabled: false`), every operation is refused
`403 commands-disabled`. Work started by another INDI client does not stop Cria
accepting an operation; the command refuses itself as `failed: busy` when the
device it needs is already moving or exposing.

### Operation

An operation is one union on `state` (`waiting`, `running`, `settled`), with
kind and parameters flat. The request is the same flat shape without the
server's fields: `{ instanceId, requestId, deviceId, kind, parameters }`.

`waiting` is a halt admitted while another operation is open on its device. It has no timing, progress or outcome yet. The schema has a `waiting`
member only for the halt kinds, so a waiting motion is not a valid Operation, in
the type or on the wire. `running` starts when the ledger starts its work,
and `settled` once its Outcome is known. Each state carries only its own
fields. Vela matches `state`, then `outcome.kind`.

The kinds and their parameters are the table in `packages/cria-wire/src/command.ts`.
Checks a client should know:

- `focuser-move` takes `position`. Cria refuses a target at or past the driver's top, or outside the configured travel
  window, as `failed: invalid`, before sending anything
  (see "The focuser travel window").
- `mount-slew` takes `coordinateSystem` `'topocentric' | 'j2000'`. Any other
  frame is `400 request-error`. A frame other than the mount's own
  settles `failed: invalid` before the mount moves.
- `capture` takes `light` (the shutter is open) and an optional `frameType`
  (`'light' | 'flat' | 'dark' | 'bias'`) that says which. See "Capture frame type".
- `camera-configure` takes `gain` and `offset`, and confirms with the values asked for.

#### Capture frame type

Before the exposure, Cria selects the camera's INDI `CCD_FRAME_TYPE` element for
the request: `FRAME_LIGHT`, `FRAME_FLAT`, `FRAME_DARK` or `FRAME_BIAS`. It writes
only when the element is not already on, and confirms the switch before it sends
`CCD_EXPOSURE`.

- `light` is required: `true` is an open shutter (`light` and `flat`), `false` a closed one
  (`dark` and `bias`). `frameType` refines it.
- A request with no `frameType` is `light` when `light` is `true` and `dark` when
  it is `false`.
- A `frameType` that disagrees with `light` (`bias` with `light: true`) is
  `400 request-error`, and nothing is sent to the camera. So is any other value:
  Cria has no `dark-flat`, which is a dark at the flats' exposure. A client asks
  for `dark`.
- A camera with no `CCD_FRAME_TYPE`, or one without the element, settles
  `failed: unsupported` before any exposure. The exception is `light` on a camera
  with no `CCD_FRAME_TYPE`, which captures as it always did.
- **A bias frame ignores the requested time.** The INDI driver exposes a bias at
  the camera's minimum whatever it is asked (seen on errai with a ZWO camera,
  2026-10-26: asked for 0.1 s, it exposed 3.2e-5 s and the FITS `EXPTIME` said so).
  So for `bias` Cria commands the minimum of `CCD_EXPOSURE_VALUE`, which it reads
  before every capture, and expects that same value in the returned frame's
  `EXPTIME`. The request's `exposureSeconds` must still be inside the camera's
  minimum to maximum, or the capture is `failed: invalid` before any exposure,
  but it is not used for anything else. Every other frame type (`light`, `flat`, `dark`) commands
  and expects the requested time. The `EXPTIME` comparison is unchanged: within
  the larger of 1 ms and 0.5 % of the commanded time. The minimum Cria reads and
  the `EXPTIME` the driver writes (`3.200000E-05`) parse to the same number, so the
  comparison needs no special case. Other drivers' bias behaviour is not
  modelled: a bias frame whose `EXPTIME` is not the commanded minimum is
  rejected like any frame that is not this exposure, and a driver that honours
  the minimum command succeeds.
- **What Vela can read.** Nothing on the wire shows the commanded time. The
  operation keeps the request as sent, so its `parameters.exposureSeconds` says
  what Vela asked for (0.1). The returned `Image.exposureSeconds` also echoes the
  request, for every frame type, including `bias`. The commanded time is in the
  `cria.write` entry on the rig stream (`CCD_EXPOSURE_VALUE`), and the camera's own
  `EXPTIME` is in the FITS Vela downloads. Vela does not read
  `Image.exposureSeconds` today. A client that needs the true bias time has the
  camera minimum from the camera's `CCD_EXPOSURE` definition on the rig stream.

A settled mount motion whose command was sent carries an optional `motion` record.
`commanded` names the kind, target or signed RA rate and axis, and `sentAt` in epoch ms.
`observed.from` is the first coordinate reading received after the command, not the cached
position before it. `observed.to` is the final position from the stopped rule. Both use
`rightAscensionDegrees` and `declinationDegrees`. `travel` is their signed difference,
with RA wrapped to [-180, 180). Missing observations are null. This is displacement
between readings, not a sum of the path or a claim of movement before the first reading.
`stopped.how` is `arrived`, `halted`, `aborted`, or `uncertain`. `stopped.at` records when
the stopped rule fired (see "Stopping the mount"). An unconfirmed stop has null final position, travel and
time. Refused commands have no motion record.
Peak rate is not computed here.

## Where the code lives

The Cria repo owns the shared packages, and Vela uses them by a git dependency
pinned to a commit (Chris, 2026-10-15). Cria produces the wire and Vela consumes
it, so the contract lives with the producer. There is no third repo and no
package registry.

- `ts/packages/primitives` is `@cria/primitives`: Outcome, Reading
  (`Reading.required` included), the disciplines. No Cria or INDI imports.
- `ts/packages/cria-wire` is `@cria/wire`: the protocol 5 schemas.
- `ts/packages/fits` is `@cria/fits`: the FITS header and `fitsFrame`. No
  dependencies.
- `ts/packages/indi` (`@cria/indi`),
  `ts/packages/fake-indi` (`@cria/fake-indi`, test support) and `ts/apps/cria` are Cria only.

### How the packages ship

A git subfolder dependency gets no build step, so the shared packages (`primitives`, `cria-wire` and `fits`) commit
their `dist/` (JavaScript, declarations, source maps). `testing/dist.test.ts`
fails if `dist/` does not match a fresh build of `src/`. Building on install
(`prepare`) was rejected, because pnpm 10 and later block dependency build scripts unless
the consumer allows them, it would need TypeScript and the dev dependencies in
Vela's install, and the packages' `workspace:` references do not resolve outside
this workspace. Shipping TypeScript sources was rejected too. Node does not strip
types inside `node_modules`, and Vela's `tsc` does not compile dependencies.

`effect` and `@cria/primitives` are peer dependencies of `@cria/wire` (and
`effect` of `@cria/primitives`), so a consumer installs one copy of each. Two
copies of Effect would make Schema and tagged-error checks fail across the seam.
Effect is pinned to exactly 4.0.3 everywhere in this workspace. Tests resolve the
workspace packages to their sources through the export condition `@cria/source`.
Consumers never see it.

A consumer adds the packages it uses at the same commit (`@cria/fits` the same
way, from `ts/packages/fits`, when it needs the conversion):

```json
"@cria/primitives": "github:chrhicks/cria#<commit>&path:/ts/packages/primitives",
"@cria/wire": "github:chrhicks/cria#<commit>&path:/ts/packages/cria-wire",
"effect": "4.0.3"
```

To change a shared package, merge the change in Cria with `dist/` rebuilt
(`pnpm build`, and `pnpm verify` passes). Then bump the commit in Vela (see the
migration checklist).

## Configuration

JSON, decoded with an Effect Schema at start. Unknown keys and invalid values
stop the process. `ts/deploy/rig.errai.json` is the rig's config:

```json
{
  "listen": { "host": "127.0.0.1", "port": 4319 },
  "indi": { "host": "127.0.0.1", "port": 7624 },
  "imageDirectory": "/var/lib/cria/images",
  "imageBudgetBytes": 1073741824,
  "commandsEnabled": true,
  "acknowledgeMs": 5000,
  "confirmMs": 15000,
  "operationTimeoutMs": 180000,
  "connectTimeoutMs": 120000,
  "operationHistory": 1000,
  "devices": [
    { "id": "primary", "kind": "camera", "indiDevice": "ZWO CCD ASI2600MC Pro" },
    { "id": "mount", "kind": "mount", "indiDevice": "ZWO AM5",
      "port": "/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_123456-if00",
      "site": { "latitudeDegrees": 33.45, "longitudeDegrees": -112.07, "elevationMeters": 331 } },
    { "id": "box", "kind": "box", "indiDevice": "Pegasus PPBA",
      "channels": [
        { "name": "12V ports", "property": "POWER_CHANNELS", "element": "POWER_CHANNEL_1" },
        { "name": "Dew A duty (%)", "property": "DEW_DUTY_CYCLES", "element": "DEW_CHANNEL_1",
          "automaticWhileOn": "Auto dew" },
        { "name": "Auto dew", "property": "AUTO_DEW_CONTROL", "element": "DEW_CHANNEL_1" }
      ] }
  ]
}
```

The example shows three of the rig's five devices. Every key but `imageDirectory`
and `devices` has a default (the values above). `acknowledgeMs` is how long a
driver has to acknowledge a command. `confirmMs` is how long it then has to show a
setting applied or a device at rest; a stop gets both. `operationTimeoutMs` is the overrun allowance
for a motion.
`connectTimeoutMs` is how long a cold device may take to connect through `device-connect`.
A device connects, and is set up, only when `device-connect` asks it to (the
rig supervisor does that on the rig), with the serial `port` written first. A
failure leaves the device disconnected and says so. Cria never changes power,
connects equipment or sets it up on its own.

A box
channel's `automaticWhileOn` names another channel of the same device under
which the driver sets this one by itself. Cria refuses a config
whose `automaticWhileOn` names no other channel.

`site` is where a mount stands: `latitudeDegrees` (-90 to 90),
`longitudeDegrees` (-180 to 180, east positive, as the wire reports it) and
`elevationMeters` (-500 to 9000). Device setup writes it to the mount (see
"Device setup"). errai's is the site already stored in the mount. `motion` tunes
how a mount stops (see "Stopping the mount"); every key is optional, with the
AM5's values as defaults: `stationaryDegrees` 0.02, `positionReadMs` 1500,
`stopLatencyMs` 900 (the coast seed for rates without a profile). Cria refuses `site` or `motion` on a device that is not a mount.

`travel` is a focuser's safe range in steps, `{ "min": 15500, "max": 38000 }`
for errai's EAF: integers from 0 to 2147483646, `min` below `max`, both ends
allowed. Cria refuses a move outside it (see "The focuser travel window"). Cria refuses `travel` on a device that is
not a focuser.

## Restarts and crashes

- **Cria restarts.** It gets a new `instanceId`, an empty ledger (operations and request IDs), and an empty image
  folder. INDI drivers keep running and keep their state, so a camera that was
  exposing still is, and a capture settles `failed: busy`. Cria remembers
  nothing about setup, so every connected device with steps is `starting` until
  a `device-connect` arrives; the rig supervisor sends it within about two polls
  (roughly 10 s), and the setup writes happen again.
- **A driver crashes.** `indiserver` deletes its properties. Cria treats the device
  as gone. An operation in flight ends `uncertain: driver-lost`. When the driver is back, the device is
  disconnected, or `starting` if it is connected, until a `device-connect` arrives: the rig
  supervisor sends it within about two polls (roughly 10 s). Run `indiserver -r 0` so indiserver does not restart a crashed
  driver by itself. Cria never restarts a driver; the outside rig supervisor may,
  in the one narrow case AGENTS.md and docs/runtime.md describe.
- **`indiserver` goes away.** Every device is gone to Cria, in-flight work is
  uncertain, and the reconnect is paced. No command is resent after reconnecting.
- **SIGTERM.** Closing the process scope interrupts every running operation. Their `stoppable`
  steps abort exposures and stop the mount and focuser before the process exits,
  and a mount's stop waits until it stands still (at most 20 s).
  `deploy/cria.service` allows 180 s (`TimeoutStopSec`), because a
  `device-connect` can run uninterruptibly for `connectTimeoutMs`.

## Image path

A capture enables BLOBs, sends `CCD_EXPOSURE` once, settles on the BLOB that
follows its own `Busy`, and disables BLOBs. The FITS payload goes into the
rolling store unchanged, as a `.fits` file with its SHA-256; Cria reads only its
header (to check the frame is its own, and for `DATE-OBS` and the cards it
publishes). Decoding the 70 MB base64 BLOB takes about 250 ms on thuban.

If a cancel arrives after the BLOB but before the operation returns, the run
settles `stopped` and Cria does not keep the frame. The camera is idle either way.

The store drops the oldest frames once the total passes `imageBudgetBytes`, and
never drops the newest. Linux keeps a deleted file readable through an open
handle, so a download that has started finishes. A request after the drop gets
`410 image-gone`. A download cut off by the client closes its file.

## Tests and verification

All tests run on thuban without hardware. Scenarios read as "given a rig state,
when Vela does X, then Cria reports Y", and assert literal values. Scenario tests
wait for a state (a fake device `Busy`, a vector on the fake INDI server, an
operation settled) with a deadline that names what they waited for, never for a
fixed time. A device is ready for commands once its `device-connect` settled
`confirmed`. A test that acts as another INDI client also waits until Cria's own
INDI mirror shows the effect, because indiserver writes to each client in turn.

`pnpm golden` drives the scenarios in `testing/golden/scenarios.ts` through the
typed client against Cria on the fake INDI server, normalizes IDs, times and
durations, and compares the result with `testing/golden/wire.golden.json`. A
change to that file is a change to the wire. `node testing/mutate.mjs <file>
<search> <replace> <test files>` shows that the given tests guard a line.
`pnpm verify` (`verify.sh`) runs build, typecheck, the `dist/` check, the golden
and the full suite, and passes on a fresh clone. See "Verification" in
`ts/README.md`.

## Rules and known limits

- **No Cria captures on the guide camera while PHD2 is guiding.** Both use the same
  INDI driver and one exposure at a time. Cria would refuse with busy or, between
  PHD2 frames, interrupt guiding with its own exposure. Cria skips PHD2's frames
  but cannot coordinate with PHD2.
- **A cancel at the moment a short motion completes** can report `stopped` instead
  of `confirmed`. The mount is stationary either way and the stop was confirmed.
  Vela treats the motion as not done and may repeat it, which is safe because the
  device state is known.
- **The request-ID map is never pruned.** Deleting a marker would let an old
  request ID run a second time. It grows by one entry per request for the life of
  the process.
- **Node 24 or later.** On Node 26 a file handle left to garbage collection is an
  uncaught error that ends the process without finalizers. Cria closes every
  image file explicitly.

## Open questions

1. **Rotate as a slew.** Polar alignment's rotate step might be better as a slew
   to a computed RA. That needs a look at how Vela uses `mount-rotate`.
2. **Dew duty step.** The PPBA advertises a 10 % step and Cria accepts only
   multiples of it; the box holds 255 steps. If 10 is only a UI step, the check
   is too strict.
3. **Not exposed yet:** the 2600's fan speed and anti-dew heater
   (`CCD_CONTROLS.FanSpeedAdjust`, `.AntiDewHeater`), the PPBA's power sensors
   and adjustable output, and guide pulses.
4. **Telemetry.** journald only. Keep it so, or bring back a small store?
5. **Effect version.** Pinned to 4.0.3 exactly, as a peer dependency of the
   shared packages. npm has 4.0.5.
6. **Private Cria, public Vela.** Vela installs `@cria/wire` from chrhicks/cria,
   which is private, while Vela is public. The options: make the Cria repo (or
   just these packages) public; give Vela's Docker build an SSH key or token; or
   copy `dist/` into Vela at each bump.
