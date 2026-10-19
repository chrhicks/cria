# Cria on Linux: TypeScript, INDI and Effect

The contract and design of the TypeScript Cria under `ts/`, as it is on `main`
in chrhicks/cria. Where the code and this file
disagree, this file is the intent and the code has the bug. To move Vela onto
this wire, follow [the Vela migration checklist](vela-migration.md).

## What this is

The legacy Cria is a .NET service on Windows that drives ASCOM through isolated
worker processes. On Linux every rig device has an INDI driver, and INDI already runs one
process per driver. So the new Cria is an INDI client. It is a TypeScript service
that connects to `indiserver` on TCP 7624, turns INDI properties into Readings,
runs bounded operations as Runs, and serves Vela over HTTP and SSE (wire protocol
5).

```
Vela server ──HTTP/SSE (protocol 5)──▶ Cria (Node, Effect) ──INDI XML/TCP──▶ indiserver ──▶ one process per driver ──▶ devices
```

What changes for the rig:

- Cria runs no worker processes. INDI's driver processes are the isolation
  boundary. Cria sees a driver crash as the device's properties disappearing.
- No COM, no STA threads, no ZWO setup dialog. Each camera is its own named INDI
  device (`ZWO CCD ASI2600MC Pro`, `ZWO CCD ASI220MM Mini`).
- INDI pushes property changes, and Cria can read a camera while it exposes, so
  Readings stay fresh during an exposure. The Windows "refresh pending for the
  whole exposure" problem (Vela PR #110) does not exist here.

Some things do not change. Vela owns runs, decisions, processing and archives. Cria owns
current device state and one bounded operation at a time per failure domain. Runs
are ephemeral. Images are a rolling set. An uncertain outcome blocks the device
until a person recovers it. Cria never resends a command blindly.

## The layers

The code follows primitives.md's four layers. Each layer imports only from the
layers above it in this list.

1. **Types** (`@cria/primitives`). `Outcome` and `Reading`. The wire schemas in
   `@cria/wire` are Views: one Effect Schema gives the type and the validator.
2. **Disciplines** (`@cria/primitives`). `writeOnce`, `confirm`, `stoppable`,
   `retryReads`, and the `quarantineOf` fold. They encode "no blind replay" and
   "honest state" once, so capabilities do not each derive them again.
3. **Capabilities** (`apps/cria/src/capability`). Camera, mount, focuser,
   weather, power (switch) and connection. Each is an INDI device seen through the
   disciplines. `observe` returns Readings, and every command returns an Outcome.
   Capabilities never see XML or sockets. They see `IndiDevice` (properties,
   states, `send`) behind the INDI boundary.
4. **Workflows run by Run** (`apps/cria/src/operation`). Each wire operation kind
   (`capture`, `focuser-move`, `mount-slew`, and the others) is a short workflow
   body over one capability. The ledger (`ledger.ts`, one per rig) admits it, and
   the failure domain's `Run` executes it with single flight, progress, stop by
   interruption, and a settled Outcome.

Two boundaries sit around the layers and map to no primitive on purpose:

- **INDI boundary** (`@cria/indi`). XML framing and parsing, the TCP connection,
  and the property mirror. This adapter absorbs protocol irregularity so nothing
  above it has to.
- **Wire boundary** (`apps/cria/src/wire`). HTTP routes, SSE, and the projection
  of the ledger's operations and the Readings into protocol 5 JSON, typed by
  `@cria/wire`. The projection functions are Views.

The image store (`apps/cria/src/image`) converts FITS to ImageBytes and keeps the
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

type FailedReason = 'busy' | 'blocked' | 'disconnected' | 'unsupported' | 'rejected' | 'invalid' | 'unavailable'
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

`unavailable` carries a closed reason. Vela's optional readers need "this device
does not have this" (`unsupported`) apart from "this read failed" (`failed`).
Times are epoch milliseconds.

`Reading.required(reading, what)` is the fresh-or-fail step a command starts
with. It returns `Effect<T, Failed>`: the value of a fresh Reading, `failed:
unsupported` for `unavailable: unsupported`, and `failed: unavailable` for every
other Reading that is not fresh (stale, not read, failed). `what` names the fact
in the message. Cria's capabilities and a consumer's commands use the same one.

**What fresh means on INDI.** INDI drivers poll their own hardware and push
changes. They do not send an unchanged value again, so Cria cannot wait for a push
to call a value fresh. A value is fresh when, within its freshness window, the INDI
connection is up, the driver answered Cria's last liveness read for that device,
and the property is not in `Alert`. A property in `Alert`, a device whose liveness
read timed out, or a lost connection makes every affected value stale (value kept,
age kept). A missing property is `unavailable: unsupported` once the device's
definitions are complete.

**Alert has two meanings.** On telemetry (a temperature) `Alert` means the read
failed, so the value is stale. On a command property (`CCD_EXPOSURE` after an
abort, a focuser position after a failed move, the mount's coordinates after a
failed slew) it means the last command failed while the value is still good. Each
Reading says which kind its property is (`alertMeansStale: false` for command
properties).

### Disciplines

All four are functions in `@cria/primitives`, generic over the device. They take
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
| A motion (slew, focuser move, exposure, park) gets a routine `Ok` update | ignored; keep waiting | Drivers send polled properties again several times a second. Only `Busy`, `Alert` or an update at the target answers a motion. |
| A number setting settles at a different value than asked (a ZWO width rounded to a multiple of 8) | `failed: rejected`, with the value the driver chose | The device state is known, so this is not uncertainty. A value within half the element's step of the request is the request applied (the PPBA holds 10 % duty as 9.8039 %); the switch channel reports the value the driver holds. |
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
and nothing persists, so an exposure error does not quarantine the camera.

**`retryReads({ read, every, timeout })`.** The paced, bounded, cancellable read
loop behind every Reading. Each read has its own timeout. A failed read makes the
affected values stale and is tried again at the same pace, never faster. The
device liveness loop and `confirm` use it.

### Run

```ts
makeRun<Input, Progress, A, Id>({ initial: (input) => Progress, work: (input, report) => Effect<A, Failed | Stopped | Uncertain> })
// → { changes, view, start(runId, input), stop(runId), await(runId) }
```

A Run is an ephemeral, observable, cancellable execution with single flight.
`start` while a run is active fails `busy`. `initial` computes the progress an
execution starts with from its input. `view` is the current view. `stop(runId)`
interrupts that execution and returns `some` of its settled view, so "stopped" is
reported only after cleanup. It returns `none` when the run ID is not the latest
execution, and never another execution's view. `await(runId)` waits until that
execution settles and returns `some` of its settled view without stopping it. It
returns `none` when the run ID is neither the latest execution nor the one before
it. Any number of callers may await the same execution. `changes`
streams every view (`idle`, `running` with progress, `settled` with the outcome),
each with its run ID. Work runs uninterruptibly except inside `stoppable`'s wait,
and the outcome comes from the body's own exit. So a cancel during a setting, or
after a motion finished, reports what really happened (`confirmed`), and `stopped`
means nothing physical happened or a stop confirmed it.

Cria has one Run per failure domain. Each wire operation is one execution, with the
operation ID as its run ID. Only the ledger starts a Run, so Run's `busy` refusal
cannot happen there. If it does, it is a ledger bug, and the operation settles
`uncertain: unexpected-error`.

### Quarantine

```ts
quarantineOf(sinceRecovery: Iterable<{ outcome; settledAt }>) → { held: false } | { held: true; reason; since }
type ExternalRecovery = { confirmed: true; note: string }   // a person checked the equipment
```

`quarantineOf` turns "an uncertain outcome" into "this device takes no more
commands until a person says it is safe". It is a fold over the endings since the
last recovery. The domain is held from the first uncertain ending, with its
message and time. No later ending releases it, a confirmed stop included. Only a
recovery starts a new list, and recovering takes an `ExternalRecovery` value, so
no code path clears it by accident.

The rule exists in at least three places today: Cria .NET's owner quarantine
(`Device.cs`), Vela's Cria client (a blocked failure domain), and Vela's mount
control refusing while an operation is unsettled (`mount-control.ts`). Here it is
one pure function of the endings, so the held state, the operation that caused
it, and its recovery come from one record and cannot disagree.

## The ledger

`apps/cria/src/operation/ledger.ts` is the one owner of operations, per rig. It
holds one immutable state in a `Ref`. Each transition (admit, progress, settle,
cancel, wait, recover, snapshot, prune) is a pure function that returns the new
state and the effects to run after it (start a Run, stop a Run, resolve waiters).
Each change increments a revision, which the ledger publishes for the event
stream.

Per failure domain the ledger keeps one fact, the current `bindingId`. The
domain is held while an operation that ended under the current binding was
uncertain. That operation is never pruned until a recovery. A recovery records
`{ at, note }` under the binding it ends and mints a new binding, shared by every
device in the domain. An operation's `recovery` is the record for the binding it
ended under, so only an uncertain operation has one.

### Admission

`POST /v2/operations` checks, in this order:

1. A known request ID with the same content returns the same operation. Other
   content is `409 request-conflict`. A request whose operation was pruned is
   `410 result-expired`.
2. `instanceId` is not this Cria's: `409 instance-changed`.
3. An unknown device: `400 request-error`.
4. `bindingId` is not the domain's current one, or `expectedName` is not the
   device's INDI name: `409 binding-changed`.
5. A kind for another device kind: `400 request-error`.
6. Commands disabled in the config: `403 commands-disabled`.
7. A halt (`mount-stop`, `focuser-halt`) is admitted now (see below).
8. A held domain: `409 device-blocked`.
9. An open operation in the domain: `409 device-busy`.

Otherwise the operation starts at once, as `running`. A motion or setting is
never queued. Admission and the start happen in one step, so nothing else is
admitted between them.

### Halts, stops and cancel

A halt runs even while the domain is held, because refusing a stop on a blocked
device would leave it moving. On an idle domain a halt starts at once. On a busy
domain it is `waiting`, and if the running operation is not itself a halt, the
ledger asks its Run to stop (its own `stoppable` halts and confirms). When an
operation settles, the oldest waiting halt starts in the same step.

So a repeated stop waits its turn and runs, sending the abort again, and settles
`confirmed` like the first. Two stops queued behind one slew both run in turn.

`POST /v2/operations/{id}/cancel` returns the operation as it is now (`202`). For a
running operation that is not a halt, it also asks the Run to stop; the outcome
says what happened. A halt, waiting or running, is returned unchanged and still
runs. A stop is never cancelled. Cancelling a settled operation returns it
unchanged.

Cancel of an operation ID Cria does not hold answers an error and cancels
nothing: `404 not-found` for an ID it never held, `410 result-expired` for one it
pruned (its request ID is still known). Both mean there is nothing to cancel, and
`GET /v2/operations/{id}` answers the same two. The first is pinned by the golden
scenario "refused: unknown operation, request and device"; the second by the
ledger test for a pruned operation.

### Recovery

`POST /v2/devices/{id}/recover` with `{ instanceId, bindingId,
externalRecoveryConfirmed: true, note }` says a person checked the equipment. It
is refused `409 device-busy` while any operation is open in the domain, so every
open operation belongs to the current binding. Otherwise it records the recovery,
mints a new `bindingId` for the whole domain, and returns the device (`200`). The
domain is no longer held. Vela must read the new `bindingId` before it commands
again.

The recovery does not need the domain to be held. On an idle domain that is not
held it is still accepted (`200`), still records `{ at, note }` under the binding
it ends, and still mints a new `bindingId`. So a request still in flight with the
old binding is refused `409 binding-changed`, and a person's recovery is a fence:
once it has answered, a request carrying the old binding can never be admitted,
and a `GET /v2/requests/{instance}/{request}` that is missing afterwards proves
the request never ran. The recovery is refused only for the reasons above:
`device-busy` while an operation is open, `binding-changed` for a binding that is
not current. The test "a recovery on a domain that is not held is accepted, mints
a new binding, and refuses a request still carrying the old one"
(`ts/apps/cria/test/operation-lifecycle.test.ts`) pins it, and the golden
scenario "recover refused while a mount-stop runs" shows its second recover
answering `200` with a new binding after a confirmed stop.

### Settle bounds

Every running operation settles in bounded time. The bound is in Cria's
configuration and in the code of its kind, and the wire does not carry it: an
operation has no deadline field, and Vela cannot read the configured values.

| Operation | Bound |
|---|---|
| Capture | The exposure plus `readoutAllowanceMs`. With no frame by then Cria aborts, and with the abort confirmed it settles `failed: unavailable`. |
| Motion (slew, park, home, focuser move) | `operationTimeoutMs` for the driver to finish the motion, then `failed: unavailable`. |
| Setting | `acknowledgeMs` for the driver to answer, then up to the confirm deadline (15 s unless the kind sets its own) for the new state; `uncertain` if either passes. |
| Stop (`mount-stop`, `focuser-halt`) and a Run's stop | `stopWithin`: 20 s for the mount and focuser, 15 s for the camera abort. |
| `device-connect` | `initializeTimeoutMs` for the driver to acknowledge the connect and again for the device to read connected, then `uncertain`. Device setup follows under its own writes' bounds. |

These bounds are per kind, not one guarantee stated in code: nothing enforces a
single limit across kinds, and a kind added later needs its own. A person's Stop
is available whatever the bound.

### What the ledger keeps

The ledger keeps the newest `operationHistory` settled operations (config, default
1000), never pruning one that holds its domain. A snapshot lists every open
operation, every one that holds a domain, and the newest 20 other settled ones.
Each domain also keeps its 16 most recently settled operation IDs, from which
`afterOperation` and the `refreshing` availability are computed.

## Module map

Each module, the primitive it is, and what it uses. Most source files start with
the same tag in their doc comment.

| Module | Primitive | Built from, notes |
|---|---|---|
| `packages/primitives/src/outcome.ts` | Outcome | Tagged errors `Failed`, `Stopped`, `Uncertain`; `settle`, `fromExit`; the reason lists |
| `packages/primitives/src/reading.ts` | Reading | `fresh`, `stale`, `unavailable`, `map`, `both`, `required`; `unavailableReasons` |
| `packages/primitives/src/discipline/write-once.ts` | Discipline: writeOnce | Outcome |
| `packages/primitives/src/discipline/confirm.ts` | Discipline: confirm | `confirm`, `writeConfirmed`; Outcome |
| `packages/primitives/src/discipline/stoppable.ts` | Discipline: stoppable | writeOnce, Outcome |
| `packages/primitives/src/discipline/retry-reads.ts` | Discipline: retryReads | Effect `Schedule` |
| `packages/primitives/src/quarantine.ts` | Quarantine | `quarantineOf`, a fold over endings; `ExternalRecovery` |
| `packages/primitives/src/run.ts` | Run | Outcome, Effect `Fiber`, `SubscriptionRef` |
| `packages/primitives/src/index.ts` | | The package's exports |
| `packages/indi/src/xml.ts` | INDI boundary | XML framing, the INDI message union, request serialization |
| `packages/indi/src/mirror.ts` | INDI boundary | Every property of every device from def, set and del messages |
| `packages/indi/src/client.ts` | INDI boundary | The TCP connection, paced reconnect, `send`, BLOB routing, and `IndiDevice` |
| `packages/indi/src/tap.ts` | INDI boundary | `TrafficTap`: what the client tells a recorder about each element sent and received |
| `packages/indi/src/index.ts` | | The package's exports |
| `packages/recording/src/format.ts` | View | The recording on disk: manifest and the line union `msg`, `conn`, `gap`, `end` as Effect Schemas |
| `packages/recording/src/recorder.ts` | Composition | The recorder: byte-bounded queue, one consumer, write order, latch-off (see "Recording") |
| `packages/recording/src/files.ts` | | The recorder's only contact with the disk, as one interface tests can stall, fill or kill |
| `packages/recording/src/reader.ts` | | `readRecording`, `readManifest` and `verifyRecording` |
| `packages/cria-wire/src/values.ts` | View | `Reading`, `Outcome`, `Timestamp`, `Json` as wire schemas |
| `packages/cria-wire/src/ids.ts` | View | Branded IDs: `InstanceId`, `OperationId`, `ImageId`, `BindingId` (UUIDs), `DeviceId`, `FailureDomain`, `RequestId` |
| `packages/cria-wire/src/command.ts` | View | The 15 operation kinds as one table: device kind, halt, parameter bounds |
| `packages/cria-wire/src/device.ts` | View | `Device`, one shape per kind; `Availability`, `Quarantine`, readings per kind |
| `packages/cria-wire/src/operation.ts` | View | `OperationRequest`, `Operation`, `Progress`, `Image` |
| `packages/cria-wire/src/state.ts` | View | `State`, `Health`, `ErrorBody`, `errorCodes`, `RecoveryRequest`, `protocolVersion` |
| `packages/cria-wire/src/index.ts` | | The package's exports |
| `apps/cria/src/capability/fields.ts` | Reading | Property to Reading, decided once: fresh, stale, unavailable |
| `apps/cria/src/capability/liveness.ts` | Reading via retryReads | Per-device liveness read; makes values fresh or stale |
| `apps/cria/src/capability/commands.ts` | Disciplines on INDI | How writeOnce, confirm and stoppable meet INDI states: `sendOnce`, `startMotion`, `switchConfirmed`, `numbersApplied`, `untilSettled` |
| `apps/cria/src/capability/context.ts` | Capability (shared) | What every capability is built from; acts only on fresh facts |
| `apps/cria/src/capability/camera.ts` | Capability: camera | writeOnce, confirm, stoppable |
| `apps/cria/src/capability/mount.ts` | Capability: mount | writeOnce, confirm, stoppable |
| `apps/cria/src/capability/focuser.ts` | Capability: focuser | writeOnce, stoppable |
| `apps/cria/src/capability/weather.ts` | Capability: weather | Readings only |
| `apps/cria/src/capability/power.ts` | Capability: power (switch) | writeOnce, confirm |
| `apps/cria/src/capability/connection.ts` | Capability: connection | writeOnce, confirm; serial port before connecting; device setup after |
| `apps/cria/src/capability/setup.ts` | Capability: device setup | writeOnce, confirm; the table of setup steps per device kind (see "Device setup") |
| `apps/cria/src/operation/workflows.ts` | Workflow bodies | One short body per operation kind over one capability, as a table keyed by kind |
| `apps/cria/src/operation/ledger.ts` | Run (with history), Quarantine | The one owner of operations per rig (see "The ledger"); `onSettled` announces each settled operation once |
| `apps/cria/src/refusal.ts` | Wire boundary | `Refusal`, a tagged error with a closed `ErrorCode`; the HTTP layer maps it to a status |
| `apps/cria/src/ids.ts` | Composition | `mint`: new instance, operation, image and binding IDs, and start-up request IDs |
| `packages/fits/src/fits.ts` | Image boundary (`@cria/fits`) | FITS (INDI BLOB) to ASCOM ImageBytes v1, and `fitsFrame`, a FITS test frame |
| `apps/cria/src/image/store.ts` | Domain storage | The rolling set: budget, `410 image-gone` after a drop |
| `apps/cria/src/wire/project.ts` | View | Readings and the ledger's facts to protocol 5 values; availability and `afterOperation` |
| `apps/cria/src/wire/http.ts` | Wire boundary | Routes, token, origin refusal, body decoding, error code to status, image download |
| `apps/cria/src/wire/sse.ts` | Wire boundary | The event stream (see "Event stream") |
| `apps/cria/src/device.ts` | Composition | What a configured device is made of: its capability and its connection, per kind |
| `apps/cria/src/rig.ts` | Composition | Builds the INDI client, devices, the ledger and the image store from config; start-up connect; device setup on each connection |
| `apps/cria/src/recording.ts` | Composition | Opens the recorder from `record`, closes it with the rig's scope; a recorder that cannot open is logged |
| `apps/cria/src/config.ts` | View, composition | The config schema with defaults, decoded once; failure domain from the INDI device name |
| `apps/cria/src/service.ts` | Composition | One scope for the whole process, served over HTTP |
| `apps/cria/src/main.ts` | Composition | Process entry (`cria <config.json>`); SIGTERM closes the scope |

Tests and test tools:

| Path | What it is |
|---|---|
| `packages/primitives/src/*.test.ts` | Outcome, disciplines, Run and the quarantine fold, on Effect's TestClock |
| `packages/indi/src/*.test.ts` | XML framing from recorded traffic, with and without the tap; the client against a real indiserver |
| `packages/recording/src/*.test.ts` | The recorder on a healthy, stalled, full and failing disk; the reader on a torn tail and on damage in the middle |
| `testing/recorder-crash.test.ts` | `kill -9` of a real process at each step of the recorder's write order |
| `testing/measure-recording-stall.ts` | Not a test: event-loop delay, other file work and memory with recording off, healthy and on a stalled disk |
| `packages/cria-wire/src/*.test.ts` | The command table, branded IDs, every wire schema |
| `apps/cria/src/**/*.test.ts` | Unit tests beside the code: ledger transitions, workflow table, units, FITS, image store, event stream |
| `packages/fake-indi/src` | `@cria/fake-indi`: a small INDI server written from the protocol, independent of `@cria/indi`'s parser; answers from its own state (`server.ts`), with generic camera and mount definitions (`devices.ts`) |
| `apps/cria/test/drivers.ts` | The rig's drivers modelled on that server: ZWO frames, the EAF, dew heaters, mount motion; `am5` models errai's mount (see "Stopping the mount") |
| `apps/cria/test/harness.ts` | Starts Cria against an INDI server and drives it over HTTP as Vela does |
| `apps/cria/test/*.test.ts` | Scenarios: fake-driver failures, mount stops, operation lifecycle, HTTP refusals, protocol 5 end to end, shutdown, real simulators, errai replay |
| `apps/cria/test/fixtures/errai-2026-10-15.xml` | The rig's recorded INDI definitions |
| `testing/indiserver.ts` | Runs a real indiserver with simulator drivers on a free port |
| `testing/cria-client.ts` | A typed protocol 5 client built from `@cria/wire`; decodes every response strictly |
| `testing/lint.test.ts` | Source rules (see "Effect decisions"); `verify.sh` strict and without pipes |
| `testing/dist.test.ts` | The committed `dist/` of the shared packages matches a fresh build |
| `testing/golden/` | The wire golden: `scenarios.ts`, the normalizer and diff in `golden.ts`, the runner `wire.golden.ts`, its `vitest.config.ts`, and the committed `wire.golden.json` |
| `testing/mutate.mjs` | Breaks one line, runs the given tests, restores the file; exits 0 when the tests went red |
| `testing/source-hook.mjs` | A Node module hook that lets `node` run `main.ts` from source, for the shutdown test |
| `verify.sh` | Every check, in order (`pnpm verify`) |

## The INDI boundary

What crosses it:

- **Out.** One `IndiDevice` per INDI device name. It has `property(name)` (a typed
  snapshot: kind, state `Idle|Ok|Busy|Alert`, permission, elements with values and
  number limits, `receivedAt`), a stream of changes, `send(name, values)` (one
  `new*Vector`, which returns when written to the socket), a liveness ping,
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
- `delProperty` without a name (driver gone or device removed) clears the device.
  Its capabilities report every value unavailable, and its in-flight command ends
  uncertain.
- The liveness read is `getProperties device=X name=CONNECTION`. The driver
  answers with that one definition (checked against libindi 2.2.5). INDI forwards
  the answer to every client of the device, so other clients (PHD2) see one small
  redundant definition per poll. libindi clients ignore a repeated definition. The
  default is every 1 s, so a value is fresh for 3 s at most without a new
  confirmation, inside Vela's 6 s budget.
- Cria enables BLOBs for a camera only around its own capture (`enableBLOB Also`
  before the exposure, `Never` after), so PHD2's guide frames do not flow through
  Cria. A capture takes only a `CCD1` BLOB that arrives after its own `Busy` and
  whose FITS `EXPTIME`, size and `DATE-OBS` (within 0.5 s) match. If only foreign
  frames come, the capture is uncertain at its deadline.
- A capture's deadline is the exposure plus `readoutAllowanceMs`. If no frame
  at all has arrived by then, Cria aborts the exposure, and with the abort
  confirmed the capture is `failed: unavailable`. A ZWO exposure after a frame the
  camera rounded never completes (see "Checked on errai"), so this bounds the
  hang. Without it the wait was the exposure plus `operationTimeoutMs`, 180 s on
  errai.

### INDI properties per reading

Standard INDI names, so the simulators and the rig drivers share them. Where the
real drivers differ, the table lists both, and the first one present wins.

| Reading | INDI property and element | Notes |
|---|---|---|
| camera `activity` | `CCD_EXPOSURE` state | `Busy` is `exposing`, else `idle` |
| camera `temperatureC` | `CCD_TEMPERATURE.CCD_TEMPERATURE_VALUE` | |
| camera `coolerOn` | `CCD_COOLER.COOLER_ON` | |
| camera `setpointC` | none | Always `unavailable: unsupported`. INDI reports the sensor temperature, not the target. See `lastCommandedSetpointC`. |
| camera `coolerPowerPercent` | `CCD_COOLER_POWER.CCD_COOLER_VALUE` | |
| camera geometry | `CCD_INFO`, `CCD_BINNING`, `CCD_FRAME` | INDI frames are in unbinned sensor pixels. Cria divides by binning, as ASCOM reports, so `width` and `height` are the size of the image Vela receives. |
| camera `gain`, `offset` | `CCD_GAIN.GAIN` or `CCD_CONTROLS.Gain`; `CCD_OFFSET.OFFSET` or `CCD_CONTROLS.Offset` | The ZWO driver uses `CCD_CONTROLS` |
| camera `bayerPattern` | `CCD_CFA` (`CFA_OFFSET_X`, `CFA_OFFSET_Y`, `CFA_TYPE`, all text) | `mono` without `CCD_CFA`; same subframe-offset rule as .NET |
| mount RA, Dec | `EQUATORIAL_EOD_COORD.RA/DEC`, else `EQUATORIAL_COORD` | `coordinateSystem` is `topocentric` (JNow) for the first, `j2000` for the second. Cria never converts frames. |
| mount `slewing` | the coordinates property's state is `Busy` | |
| mount `tracking`, `parked` | `TELESCOPE_TRACK_STATE.TRACK_ON`, `TELESCOPE_PARK.PARK` | |
| mount `pierSide` | `TELESCOPE_PIER_SIDE` | `PIER_EAST` is `east`, `PIER_WEST` is `west`, else `unknown` |
| mount `trackingRate` | `TELESCOPE_TRACK_MODE` | `sidereal`, `lunar`, `solar`; another mode is unavailable |
| mount rate offsets | `TELESCOPE_TRACK_RATE` | |
| mount site | `GEOGRAPHIC_COORD.LAT/LONG/ELEV` | INDI longitude is 0 to 360 east. Cria reports -180 to 180, east positive. |
| mount `siderealTimeHours` | `TIME_LST` if present, else computed | Computed from the system clock and the site longitude |
| mount `primaryAxisRates` | `TELESCOPE_SLEW_RATE` | Named rates with degrees per second, parsed from the labels |
| focuser | `ABS_FOCUS_POSITION`, `FOCUS_MAX`, `FOCUS_TEMPERATURE`, `FOCUS_ABORT_MOTION` | `moving` is the position `Busy`; `maxStep` is the smallest of `FOCUS_MAX`, the position's maximum and the travel window's `max`; `minStep` the larger of the position's minimum and the window's `min` (see "The focuser travel window") |
| weather | `WEATHER_PARAMETERS.WEATHER_TEMPERATURE`, `_HUMIDITY`, `_DEWPOINT`, and the rest | A missing element is `unsupported` |
| switch channels | the configured `property.element` list | For example `POWER_CHANNELS.POWER_CHANNEL_1` (12 V master) |

Commands use the same properties: exposure `CCD_EXPOSURE`, abort
`CCD_ABORT_EXPOSURE`, cooler `CCD_COOLER` and `CCD_TEMPERATURE`, slew
`ON_COORD_SET=TRACK` then the coordinates, stop `TELESCOPE_ABORT_MOTION`, park
`TELESCOPE_PARK`, home `TELESCOPE_HOME.GO`, axis motion `TELESCOPE_MOTION_WE` and
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
  `EQUATORIAL_COORD`, `TELESCOPE_PARK`, `TELESCOPE_HOME`, `TELESCOPE_MOTION_WE` and
  `TELESCOPE_MOTION_NS` is `Busy`, and the mount stands still (see "Stopping the
  mount"). The state alone is not enough: the AM5 goes `Idle` at once and coasts.
- **A cooling setpoint is confirmed** only by `Busy` (regulating) or `Ok` at the
  setpoint, not by a routine temperature update.
- **A subframe is in binned pixels on the wire.** `camera-configure` takes
  `startX`, `startY`, `width` and `height` in binned pixels, the unit of the
  image Vela receives and of the camera's readings. Cria multiplies by the
  binning to write `CCD_FRAME`, which INDI keeps in sensor pixels. The two units
  were mixed before: Cria checked the region in binned pixels at the old binning,
  so `{ binX: 2, binY: 2 }` on the 2600 failed `Subframe exceeds the sensor`.
  One unit, the one the image has, leaves Vela nothing to convert.
- **A subframe on the camera's grid, or nothing is sent.** A ZWO camera given a
  frame off its grid uses a smaller frame, while `CCD_FRAME` soon shows the frame
  asked for, and the next exposure never completes. So Cria checks every field it
  will send before sending anything: the fields asked for, and those kept from the
  current frame, which a new binning can put off the grid. The grid is in binned
  pixels. It is the camera's configured `frameGrid` (binned pixels), combined with
  the `CCD_FRAME` element's `step` when the driver defines one. That step is in
  sensor pixels, so at bin 2 a step of 16 means a multiple of 8 binned pixels. A
  field off the grid settles `failed: invalid`, naming the nearest binned values
  on the grid, as in "width 476 binned pixels; the camera needs a multiple of 8
  binned pixels; nearest 472 or 480". A kept field is named as "(the current
  width)". A region past the sensor's edge is refused the same way. Cria never
  moves the region itself. Start offsets have no configured grid, because
  nothing measured says the cameras need one.
- **A binning change moves the frame.** indi_asi_ccd recomputes `CCD_FRAME` by
  itself after a `CCD_BINNING` write. So Cria writes the binning, waits until
  `CCD_FRAME` is not `Busy` and has held still for 1 s, and only then writes the
  frame. Without that wait the frame write was judged against the driver's
  recompute, not against its own answer. A binning-only request writes only
  `CCD_BINNING` and keeps the physical region. Its `confirmed` values are the
  geometry the driver then holds, in binned pixels, so a recompute that trims the
  region (6248 to 6240 wide at bin 2) shows there and is not an error. Every
  `camera-configure` that touches binning or the region confirms with `binX`,
  `binY`, `startX`, `startY`, `width` and `height` as applied, plus `gain` and
  `offset` when asked.
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
2026-10-15 (see "Checked on errai"): a cancelled slew at about 3°/s went `Idle` at
once and moved 3.6° more over 2 s, and an 8x rotate (0.2507°/s) overshot by its
rate times 0.9 s. So a stop (an abort, an axis halt) is confirmed only when:

1. none of the motion properties above is `Busy`, and
2. two reads of the mount's position, each a definition the driver sends again
   (`getProperties` for the coordinates, as the liveness read does), at least
   `positionReadMs` apart (1.5 s), differ by at most `stationaryDegrees` (0.02°)
   on each axis, and the coordinates are not `Busy`.

Reads, not pushed updates: INDI publishes a position only when it moves by more
than 0.1 arcsecond (libindi 2.2.5, `Telescope::NewRaDec`), so a still mount that
tracks publishes nothing, and the same update read twice would prove nothing.
Each read is a fresh answer from the driver, and 1.5 s is longer than
indi_lx200am5's 1 s poll of the mount, so two reads straddle at least one poll.
Each axis, not the angle on the sky: at the pole a turning RA axis barely moves
the pointing.

The tolerance and the sidereal drift. With tracking off the mount stands still
against the ground and its RA advances 15.04 arcseconds a second (0.0042°/s), so
two reads 1.5 s apart differ by 0.0063° in RA. With tracking on the coordinates
hold still. 0.02° is three times that drift and far below coasting (the measured
tail moved 0.17° in its last second), so Cria compares the axes without removing
the drift.

The stop is bounded by `stopWithin` (20 s): inside `stoppable` the abort is sent
again until it is confirmed or the 20 s pass, and `mount-stop` gives up at 20 s.
Unconfirmed, the outcome is `uncertain: stop-not-confirmed`, never `confirmed`.
This covers `mount-stop`, cancelling a slew, park, home, `mount-axis` or
`mount-rotate`, and SIGTERM.

**A rotate leads its stop.** The mount keeps going for about `stopLatencyMs`
(900 ms, measured on the AM5) at the axis rate after Cria sees it reach a target,
so `mount-rotate` halts the axis when it has travelled the distance less
rate × `stopLatencyMs`, confirms the mount still, and reports the travel it
measured. A rotate whose lead is more than `maxLeadFraction` (half) of its
distance is refused before moving, as `failed: invalid`: at the AM5's 9x
(3.008°/s) the lead is 2.7°, so a 1° rotate at 9x is refused. The 0.9 s is one
measurement at 8x that lumps together the driver's 1 s position poll, the serial
link and the deceleration, so a rotate can still miss by up to its rate times
1 s, and more at high rates, where the AM5 also decelerates for longer. The
reported `travelledDegrees` is the truth either way.

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
| mount | site | `GEOGRAPHIC_COORD` `LAT`, `LONG` (0 to 360 east), `ELEV` from the device's `site`, confirmed by the driver's echo (`numbersApplied`) | no `site` configured, or the mount has no `GEOGRAPHIC_COORD` |
| mount | time, after the site | `TIME_UTC` `UTC` from the system clock (`YYYY-MM-DDTHH:MM:SS`), `OFFSET=0.00`, confirmed by the echoed `UTC` | the mount has no `TIME_UTC` |

Why each step exists:

- **Frames to Cria.** A camera on `UPLOAD_LOCAL` saves frames on the rig's disk
  and sends Cria nothing, so captures were refused. errai's 2600 was on local.
- **Site, then time.** The AM5 refuses every goto until its site and time are
  set after it powers on. It answers `:MS#` with `e7#` ("time and site not
  synchronized"). In indi_lx200am5 the `GEOGRAPHIC_COORD` write sends `:Sg` then
  `:St`, and the `TIME_UTC` write sends `:SG`, `:SL` and `:SC` (libindi 2.2.5
  source). The raw sequence `:St`, `:Sg`, `:SG`, `:SC`, `:SL` made the mount
  accept gotos on errai. The time uses offset 0, so the mount's local time is UTC
  and the two agree.

**When it runs.** Each time a device is connected and has not been set up since
it connected. A connection ends when the device disconnects, its driver goes away
(`delProperty` without a name) or the indiserver connection is lost, so a driver
that comes back is set up again. Setup runs as an ordinary `device-connect`
operation (`connected: true`, request ID `startup-…`) through the ledger, on a
device that is already connected, so it connects nothing. That makes it
single-flight with Vela's operations, quarantines the device if a step ends
uncertain, and shows in the operation list. A device with nothing to write gets
no operation. A refused submission (the domain busy or held) sent nothing and is
tried again. A setup that ran is not run again until the device connects again,
or someone sends `device-connect` with `connected: true`, which always runs the
setup steps after connecting (`connect: true` at start included). With commands
disabled, setup does not run.

**What it reports.** No wire change. The `device-connect` outcome's values carry
`setup`, one string of what each step did, for example
`sent GEOGRAPHIC_COORD LAT=40 LONG=285 ELEV=0; sent TIME_UTC UTC=2026-10-16T00:21:47 OFFSET=0.00`
or `UPLOAD_MODE already sends frames to Cria`. Until setup has run on a
connection, the device's availability is `starting` with the message
`Waiting for device setup`, so Vela does not command a mount that would refuse
its goto. A step that is not confirmed ends the operation `uncertain`; the
device is then `blocked` with the step named in the message, as
`Blocked until a person recovers it: setup: TIME_UTC on ZWO AM5: no answer within 5s`,
until a person recovers it. A step the driver refuses ends it `failed` and the
device stays ready; the next capture or goto says why it fails. These reuse
`availability` and the quarantine, so no reason was added to the wire.

**A refused goto says why.** When the mount refuses a goto with `Alert` and its
setup since connecting is not complete (not run, a step failed, or no site
configured), the outcome is `failed: rejected` with
`The mount refused the goto (Alert on EQUATORIAL_EOD_COORD). An AM5 refuses every goto until its site and time are set after it powers on. Setup since it connected: GEOGRAPHIC_COORD not sent: no site is configured for this mount; sent TIME_UTC UTC=… OFFSET=0.00`.
The mount's real reply (`e7#`) is not visible through INDI: the lx200 driver
accepts only a digit as the first reply character and logs `Slew failed (-1)`,
and Cria no longer parses driver messages. With setup complete, a refused goto
keeps the driver's message.

**Not yet proven on the mount.** That the two INDI writes alone clear the AM5's
e7 is not verified: on errai the mount was already synchronized by the raw
commands, and it stays synchronized until it is powered off. A power-cycle test
on the rig, with Chris present, settles it: power the mount off and on, start
Cria, and slew.

### The focuser travel window

A focuser's driver range is not the range that is safe for the hardware. On
errai the EAF's `FOCUS_MAX` is 100000 (a user setting), `ABS_FOCUS_POSITION`
allows 0 to 60000, and the focus tube is already far out at 32749: Chris chose
15500 to 38000 as the safe range (2026-10-15). So a focuser has an optional
`travel: { min, max }` in the config (see "Configuration"), and errai's EAF has
15500 to 38000. Cria never writes `FOCUS_MAX`; the window lives in Cria.

**What Cria reports.** `maxStep` is the smallest of `FOCUS_MAX` (when the driver
defines it), the position's own maximum and `travel.max`; `minStep` is the
larger of the position's own minimum and `travel.min`. Without a window they are
the driver's range, and `maxStep` no longer reports a `FOCUS_MAX` above what the
position accepts. Vela's autofocus builds its search window from these two, so
they are the usable window.

**Without a window, or with a window as high as the driver's top**, `maxStep` is
the driver's top itself, and that value is not a usable target: the first refusal
below (`approaches the mechanical limit`) refuses a target at or past the
driver's top, so the highest target that is allowed is one step below it. "Both
ends allowed" holds for a configured `travel.max` below the driver's top, such as
errai's 38000, and for `minStep` always. A focuser with no window and a
consumer that targets `maxStep` is refused `failed: invalid`; keep one step of
margin below `maxStep` when no window is configured. The limits come from the property's definition, so
an `Alert` on the position (a refused move) does not make them, or `absolute`,
stale. Before, `absolute` went stale on that `Alert`, and every later move
failed `unavailable` until another move cleared it.

**What Cria refuses**, as `failed: invalid` before sending anything:

- a target at or past the driver's top (the smaller of `FOCUS_MAX` and the
  position's maximum): `Focuser target approaches the mechanical limit`, as
  before. Before this change a target between 60000 and 100000 passed this
  check on errai and the driver refused it (`Alert`, `failed: rejected`);
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
| `GET /health` | `{ status: 'ok', protocolVersion: 5 }`. No token. |
| `GET /v2/state` | One `State` snapshot. |
| `GET /v2/events` | The event stream (see "Event stream"). |
| `POST /v2/operations` | `OperationRequest`, answered `202` with the `Operation` (see "Admission"). |
| `GET /v2/operations/{id}` | `Operation`, `404 not-found`, or `410 result-expired`. |
| `GET /v2/requests/{instance}/{request}` | The operation for a request ID, for a lost POST response. `404 not-found` if unknown. |
| `POST /v2/operations/{id}/cancel` | `202` with the `Operation`; `404 not-found` for an unknown ID, `410 result-expired` for a pruned one (see "Halts, stops and cancel"). |
| `POST /v2/devices/{id}/recover` | `RecoveryRequest`, answered `200` with the `Device` (see "Recovery"). |
| `GET /v2/images/{id}/original` | ImageBytes v1 with an exact `content-length` and `ETag` = SHA-256. `410 image-gone` for an image ID Cria no longer holds or never held. `404 not-found` for a path segment that is not an image ID. |

When a token is configured, every route except `/health` needs
`Authorization: Bearer <token>`. A request with an `Origin` header is refused, so
a browser cannot call Cria. Request bodies are limited in size.

### Errors

An error is `{ error: { code, message }, instanceId }`. `code` is one of the
closed `errorCodes` list, and each code has exactly one HTTP status:

| Status | Codes |
|---|---|
| 400 | `request-error` |
| 401 | `unauthorized` |
| 403 | `origin-rejected`, `commands-disabled` |
| 404 | `not-found` |
| 409 | `request-conflict`, `instance-changed`, `binding-changed`, `device-blocked`, `device-busy` |
| 410 | `result-expired`, `image-gone` |
| 413 | `request-too-large` |
| 429 | `too-many-subscribers` |
| 500 | `internal-error` |

### State

```ts
State = {
  protocolVersion: 5
  instanceId: string          // a new one on every Cria start: everything in flight before it is unknown
  sequence: number            // counts snapshots of this rig, from 1; GET /v2/state and the event stream share it
  generatedAt: number         // epoch ms, when this snapshot was built
  commandsEnabled: boolean
  devices: Device[]
  operations: Operation[]     // see "What the ledger keeps"
}
```

### Reading on the wire

Exactly the primitive, with epoch milliseconds:

```ts
Reading<T> =
  | { status: 'fresh'; value: T; observedAt: number }
  | { status: 'stale'; value: T; observedAt: number }
  | { status: 'unavailable'; reason: 'not-read' | 'unsupported' | 'failed'; message?: string }
```

Cria decides freshness once, as of `generatedAt`. Vela does not derive it again
from read times. What Vela still owns is the age of the snapshot itself. A snapshot
that has stopped arriving says nothing about now, so Vela treats readings as
interrupted when its event stream is interrupted.

### Device

One shape per kind, so every reading has a typed value:

```ts
Device = {
  id: string; kind: 'camera' | 'mount' | 'focuser' | 'weather' | 'switch'
  name: string                // the INDI device name; operation requests send it as expectedName
  bindingId: string           // one per failure domain; changes on recovery
  failureDomain: string
  availability: { ready: true } | { ready: false; reason: AvailabilityReason; message: string }
  quarantine: { held: false } | { held: true; reason: string; since: number }
  afterOperation: string | null
  readings: { ... per kind, below }
  // kind 'switch' only:
  channels: Array<{ id, name, writable, minimum, maximum, step, on, value }>   // each a Reading
  // kind 'camera' only:
  lastCommandedSetpointC: { value: number; commandedAt: number } | null
}

AvailabilityReason = 'commands-disabled' | 'blocked' | 'unavailable' | 'starting'
                   | 'disconnected' | 'stale' | 'busy' | 'refreshing'
```

`availability` says why a device cannot take a command now. The reasons, in order
of precedence: commands disabled; quarantine held; indiserver or the driver gone;
no liveness read yet; device disconnected; connection or name not fresh; device
setup not run yet on this connection (`starting`, see "Device setup"); a Cria
operation open in the failure domain; not read again since the last operation
settled. Work started by another INDI client does not make a device unavailable.
It shows in the readings (a camera's `activity` is `exposing`), and Cria refuses
the operation as `failed: busy`.

`afterOperation` is the ID of the latest settled operation in the device's failure
domain that every fresh reading on the device postdates (the driver was read after
it settled), or null. After Vela's own operation settles, Vela waits until each
device it reads shows `afterOperation` equal to that operation's ID before it
treats the readings as the result of the write.

`lastCommandedSetpointC` is the last setpoint Cria sent that the driver
acknowledged (`Busy`, or `Ok` at the setpoint), with when. `readings.setpointC` is
always `unavailable: unsupported`.

Readings per kind. Values are named, not ASCOM integers:

| Kind | Readings |
|---|---|
| all | `connected` boolean, `name` string |
| camera | `activity` `'idle' \| 'exposing'`; `temperatureC`, `setpointC` (unsupported), `coolerOn`, `coolerPowerPercent`; `sensorWidthPixels`, `sensorHeightPixels`, `pixelWidthMicrons`, `pixelHeightMicrons`, `binX`, `binY`, `width`, `height`, `startX`, `startY` (binned), `maxBinX`, `maxBinY`; `bayerPattern` `'mono' \| 'rggb' \| 'grbg' \| 'gbrg' \| 'bggr'`; `canAbortExposure`, `canSetTemperature`, `canGetCoolerPower`; `exposureMinimum`, `exposureMaximum`; `gain`, `gainMinimum`, `gainMaximum`, `offset`, `offsetMinimum`, `offsetMaximum` |
| mount | `rightAscensionHours`, `declinationDegrees`, `siderealTimeHours`; `slewing`, `tracking`, `parked`; `trackingRate` `'sidereal' \| 'lunar' \| 'solar'`; `rightAscensionRateSecondsPerSiderealSecond`, `declinationRateArcsecondsPerSecond`; `pierSide` `'east' \| 'west' \| 'unknown'`; `coordinateSystem` `'topocentric' \| 'j2000'`; `latitudeDegrees`, `longitudeDegrees` (east positive), `elevationMeters`; `canSlew`, `canSetTracking`, `canFindHome`, `canPark`, `canUnpark`, `canMovePrimaryAxis`; `primaryAxisRates` `Array<{ name, degreesPerSecond }>` |
| focuser | `position`, `moving`, `temperatureC`, `absolute`, `minStep`, `maxStep` (the usable window; both ends allowed except `maxStep` at the driver's top; see "The focuser travel window") |
| weather | `temperatureC`, `humidityPercent`, `dewPointC`, `pressureHpa`, `skyTemperatureC`, `cloudCoverPercent`, `rainRateMmPerHour`, `windSpeedMps`, `windGustMps` |
| switch | `channelCount`; per channel `id`, `name`, `writable`, `minimum`, `maximum`, `step`, `on`, `value` |

### Operation

```ts
Operation =                                  // one union on state; kind and parameters stay flat
  | { ...Accepted; state: 'waiting' }                                     // a halt kind only
  | { ...Accepted; state: 'running'; startedAt: number; progress: Progress }
  | { ...Accepted; state: 'settled'; startedAt: number; settledAt: number
      outcome: Outcome<{ values: Record<string, Json>; image: Image | null }>
      recovery: null | { at: number; note: string } }                    // non-null only on a recovered uncertain operation

Accepted = {
  id, instanceId, requestId, deviceId, bindingId, expectedName, failureDomain
  kind: OperationKind; parameters: <the kind's parameters>
  acceptedAt: number
}
Progress = { phase: 'preparing' | 'exposing' | 'readout' | 'retaining'; elapsedSeconds: number | null }
```

The request is the same flat shape without the server's fields:
`{ instanceId, requestId, deviceId, bindingId, expectedName, kind, parameters }`.

`waiting` is a halt admitted while another operation is open in its failure
domain. It has no timing, progress or outcome yet. The schema has a `waiting`
member only for the halt kinds, so a waiting motion is not a valid Operation, in
the type or on the wire. `running` starts when the operation is handed to its
Run, and `settled` once its Outcome is known. Each state carries only its own
fields. That only an uncertain operation has a `recovery` is a schema check,
because TypeScript cannot narrow on the nested `outcome.kind`. Vela matches
`state`, then `outcome.kind`. Whether the device is quarantined is a device fact
(`quarantine`), not an operation field.

The 15 kinds and their parameters are the table in `packages/cria-wire/src/command.ts`.
Two of their checks matter to Vela:

- `focuser-move` takes `position` with the travel window `minPosition` and
  `maxPosition`, and the schema refuses a position outside the window. Cria also
  refuses a target at or past the driver's top, or outside the configured travel
  window (`minStep` to `maxStep`), as `failed: invalid`, before sending anything
  (see "The focuser travel window").
- `mount-slew` takes `coordinateSystem` `'topocentric' | 'j2000'`. Any other
  frame is `400 request-error`. A frame other than the mount's own
  (`readings.coordinateSystem`) settles `failed: invalid` before the mount moves.
- `camera-configure` takes its region in binned pixels and confirms with the
  geometry the driver holds (see "A subframe is in binned pixels on the wire").

`Image` has `id`, `operationId`, `instanceId`, `deviceId`, `cameraName`,
`bindingId`, `width`, `height`, `binX`, `binY`, `startX`, `startY`,
`exposureSeconds`, `color`, `capturedAt`, `capturedAtSource`
(`'camera' | 'server-estimate'`), `retainedAt`, `sha256`, and
`original: { mediaType: 'application/imagebytes', bytes, url }`.

### Event stream

`GET /v2/events` is SSE. Each event is `event: state` with `data: <State>`. A new
subscriber gets a snapshot at once. After that a snapshot goes out at least once a
second, and within 250 ms of a ledger change. The stream sends nothing else. There
is no heartbeat comment, because the one-second cadence already shows the
connection is alive. Vela uses that cadence to detect a broken stream.

The stream is not a log. Changes that land between two ticks coalesce into one
snapshot. The stream sends a snapshot for the ledger revision captured with that
snapshot, so a change that lands while a snapshot is being built goes out in the
next one. A reconnect gets a fresh snapshot, with no replay. A subscriber whose
socket is not draining gets no new writes until it drains, and is dropped after
30 s stuck. At most 16 subscribers are accepted at once; the 17th gets
`429 too-many-subscribers`.

### Changed from protocol 4

Protocol 4 is the .NET Cria's wire (`contract/openapi.json`). [The Vela migration
checklist](vela-migration.md) says what Vela changes for each row.

| Protocol 4 | Protocol 5 |
|---|---|
| `protocolVersion: 4` | `5` |
| Operation `status` (`accepted`, `running`, `succeeded`, `failed`, `cancelled`, `uncertain`), `settled`, `blocksDevice`, `cancelRequested`, `acknowledged`, `observation` | `state` (`waiting`, `running`, `settled`), each with only its own fields; `outcome.kind` (`confirmed`, `failed`, `stopped`, `uncertain`) on `settled` |
| Operation `message`, `result`, `image`, `reservedImageId` | `outcome.message`; `outcome.value.values`; `outcome.value.image` |
| Operation `completedAt`, flat `phase` (open string), `elapsedSeconds` | `settledAt`; `progress.phase` (closed list), `progress.elapsedSeconds` |
| Operation `reconciliation { at, note, externalRecoveryConfirmed }` | `recovery { at, note }` |
| Reading `{ value, observedAt, checkedAt, readStartedAt, generation, status: pending, current, unsupported, error, stale, message }` | `fresh`, `stale`, or `unavailable` with a reason |
| Device `fields`, `expectedName`, `health`, `commandReady`, `blocked`, `reason`, `observationGeneration`, `refreshPending` | `readings` typed per kind, `name`, `availability`, `quarantine`, `afterOperation` |
| ASCOM integers (camera state, pier side, tracking rate, coordinate system), `sensorType` and Bayer offsets | Named values; `activity`, `bayerPattern` |
| `canStopExposure`, `atHome`, image `preview` | Removed |
| `primaryAxisRates: [{ minimum, maximum }]` | `[{ name, degreesPerSecond }]` |
| Focuser `maxStep` from `FOCUS_MAX`; no lower bound | `maxStep` the smallest of `FOCUS_MAX`, the position's maximum and the travel window; `minStep` added |
| `setpointC` reading | Always unsupported; `lastCommandedSetpointC` |
| `mount-slew` frames `j2050`, `b1950` | Refused; `topocentric` or `j2000` only |
| `error.code` an open string | A closed list, one status per code |
| `GET /v2/images/{id}/original` with a malformed ID: `410 image-gone` | `404 not-found` |
| A second stop behind a running operation settled `failed: busy`, unsent | Waits its turn and runs |
| Recovery while an operation is open | Refused `409 device-busy` |
| A `bindingId` per device | One per failure domain |
| `sequence` one counter for the process | Per rig |
| SSE `: heartbeat` comment after about 4 s without a write | None; a snapshot at least once a second |
| `POST /v2/devices/{id}/refresh`, `/v2/schema`, `/v2/service`, `/v2/service/stop`, `/v2/telemetry/*` | Removed |

## Where the code lives

The Cria repo owns the shared packages, and Vela uses them by a git dependency
pinned to a commit (Chris, 2026-10-15). Cria produces the wire and Vela consumes
it, so the contract lives with the producer. There is no third repo and no
package registry.

- `ts/packages/primitives` is `@cria/primitives`: Outcome, Reading
  (`Reading.required` included), the disciplines, Run (`makeRun`: `changes`,
  `view`, `start`, `stop`, `await`), Quarantine. No Cria or INDI imports.
- `ts/packages/cria-wire` is `@cria/wire`: the protocol 5 schemas.
- `ts/packages/fits` is `@cria/fits`: FITS header, FITS to ImageBytes v1 and
  `fitsFrame`. No dependencies. Vela's packager uses it to compute the same
  ImageBytes SHA-256 that Cria does.
- `ts/packages/indi` (`@cria/indi`), `ts/packages/recording`,
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

A consumer adds both packages at the same commit:

```json
"@cria/primitives": "github:chrhicks/cria#<commit>&path:/ts/packages/primitives",
"@cria/wire": "github:chrhicks/cria#<commit>&path:/ts/packages/cria-wire",
"effect": "4.0.3"
```

Checked on 2026-10-15 from a scratch package outside the repo (Node 26.10, pnpm
11.22): both `git+file://` and `github:` forms install from the pinned commit
with one copy of each package, the consumer decodes a protocol 5 state with plain
Node, and `tsc` passes with `skipLibCheck: false`. Without GitHub credentials the
install fails (`ERR_PNPM_GIT_FETCH_FAILED`), because chrhicks/cria is private.

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
  "imageBudgetBytes": 10737418240,
  "commandsEnabled": true,
  "livenessMs": 1000,
  "acknowledgeMs": 5000,
  "operationTimeoutMs": 180000,
  "readoutAllowanceMs": 30000,
  "initializeTimeoutMs": 120000,
  "operationHistory": 1000,
  "devices": [
    { "id": "primary", "kind": "camera", "indiDevice": "ZWO CCD ASI2600MC Pro", "connect": false,
      "frameGrid": { "width": 8, "height": 2 } },
    { "id": "mount", "kind": "mount", "indiDevice": "ZWO AM5", "connect": false,
      "port": "/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_123456-if00",
      "site": { "latitudeDegrees": 40.0, "longitudeDegrees": -75, "elevationMeters": 0 } },
    { "id": "switch", "kind": "switch", "indiDevice": "Pegasus PPBA",
      "channels": [
        { "name": "12V ports", "property": "POWER_CHANNELS", "element": "POWER_CHANNEL_1" },
        { "name": "Dew A duty (%)", "property": "DEW_DUTY_CYCLES", "element": "DEW_CHANNEL_1",
          "automaticWhileOn": "Auto dew" },
        { "name": "Auto dew", "property": "AUTO_DEW_CONTROL", "element": "DEW_CHANNEL_1" }
      ] }
  ]
}
```

The example shows three of the rig's six devices. Every key but `imageDirectory`
and `devices` has a default (the values above). `acknowledgeMs` is how long a
driver has to acknowledge a command. `operationTimeoutMs` is the overrun allowance
for a motion, and for a camera's frame to settle after a binning change. `readoutAllowanceMs` is how
long after an exposure's duration Cria waits for its frame before aborting it.
The 30 s default is a guess with room for a full 2600 frame, not a measured
readout time.
`initializeTimeoutMs` is how long a cold device may take to connect at start.
Each device's failure domain is its INDI device, so the Pegasus weather and
switch share one. `connect: true` sends `CONNECT` once at start if the device is
disconnected, as a `device-connect` operation (request ID `startup-…`) with the
serial `port` written first. A failure leaves the device disconnected and says so.
Cria never changes power or connects equipment implicitly.

`frameGrid` gives a camera's subframe grid in binned pixels (`width`, `height`),
which indi_asi_ccd's `CCD_FRAME` definition does not give (`step="0"`). A switch
channel's `automaticWhileOn` names another channel of the same device under
which the driver sets this one by itself. Cria refuses a config
whose `automaticWhileOn` names no other channel.

`site` is where a mount stands: `latitudeDegrees` (-90 to 90),
`longitudeDegrees` (-180 to 180, east positive, as the wire reports it) and
`elevationMeters` (-500 to 9000). Device setup writes it to the mount (see
"Device setup"). errai's is the site already stored in the mount. `motion` tunes
how a mount stops (see "Stopping the mount"); every key is optional, with the
AM5's values as defaults: `stationaryDegrees` 0.02, `positionReadMs` 1500,
`stopLatencyMs` 900 (measured on the AM5), `maxLeadFraction` 0.5. Cria refuses
`site` or `motion` on a device that is not a mount.

`record` turns on recording of INDI traffic (see "Recording"): `dir`, `reserveGb`
and `queueMb`, all three required when it is present.

`travel` is a focuser's safe range in steps, `{ "min": 15500, "max": 38000 }`
for errai's EAF: integers from 0 to 2147483646, `min` below `max`, both ends
allowed. Cria reports it in `minStep` and `maxStep` and refuses a move outside
it (see "The focuser travel window"). Cria refuses `travel` on a device that is
not a focuser.

## Recording

Cria can record every element it sends to and receives from `indiserver`, so a
night can be replayed and queried later. It is off unless the config has
`record`. The packager and replay that read these recordings are separate
programs; Cria only writes. A recording is a diagnostic copy of what Cria saw,
not custody: no operation, request, response or Vela image depends on it, the
rolling image set is unchanged, and Cria owes Vela nothing about it.

```json
"record": { "dir": "/var/lib/cria/recordings", "reserveGb": 20, "queueMb": 256 }
```

`reserveGb` is how much free space recording must leave on the disk. `queueMb`
is how much memory a slow disk can make recording hold, approximately: image
bytes, element text and 256 bytes per entry.

Each Cria start opens one folder, `<start time>-<instanceId>`, under `dir`:

- `manifest.json`, written once at start and never rewritten: the format, the
  `instanceId`, the INDI host and port, which INDI device is which Cria device
  (no serial ports and no site) and the two limits.
- `traffic.jsonl`, one JSON line per event in the order Cria saw them:
  `msg` (`t`, `at`, `conn`, `dir` `in` or `out`, `n` counting from 0 per
  connection and direction, the element's wire `xml`, and `blobs`), `conn` (a
  TCP session opened or closed), `op`, `gap` and `end`. A missing `end` means Cria died.
- `op` is an operation that has just settled, written from the ledger's
  `onSettled` hook: the operation exactly as protocol 5 shows it, so the packager
  has Cria's own times for it (`acceptedAt`, `startedAt`, `settledAt`) on the same
  clock as the INDI lines, and joins a write to its operation by the time window
  without a clock shared with Vela. Each settled operation is one `op` line. Lines for
  operations on different devices can swap by a few milliseconds; each carries its
  own `settledAt`. The `recovery` field is `null`, as at the moment of
  settling.
- `blobs/<connection>-<n>-<index>.blob`, one file per image payload, in the
  `msg` line's `blobs` and named by a `ref` on the elided `<oneBLOB .../>` in its
  `xml`. Nothing is hashed on errai.

The tap sits in `@cria/indi`'s client, after the framer, so recording reuses the
bytes and decoded images Cria already parsed. `xml` is the element's wire text,
not a re-serialized message, because Cria's parser drops `rule`, `group` and
`format`, which replay needs. Outgoing elements are recorded in `transmit`, the
one place the client writes to the socket, before the write.

The tap's `message` and `connection` return at once, do no I/O and never throw.
One consumer writes the files, for each entry:

1. each image to `<name>.partial`, then fsync it, rename it, fsync the folder;
2. only then append the entry's line.

A line therefore never names an image that is not on disk. A crash between the
two leaves an image no line names, which `verifyRecording` lists and ignores. A
crash inside the append leaves a torn last line, which the reader drops. The
traffic file is flushed about once a second and when the queue is idle.

**Recording stops for good at the first failure.** The failures are a full queue
(the next entry would pass `queueMb`), free space that would drop below
`reserveGb`, and any I/O error. Recording then frees its queue, writes a `gap`
line (its reason and how many entries and bytes were dropped) unless an append
may have left a torn line, logs once, and takes no more entries for the rest of
that run. It never resumes, because a half-written line in the middle of the file
would corrupt everything after it. Cria keeps observing, and no capture waits on
the disk. The next Cria start opens a new recording. A recorder that cannot open
at start, or has not opened after five seconds on a stalled disk, is logged and
Cria runs unrecorded. Closing waits at most five seconds for a stalled disk, then
lets go of the recording without waiting for its file.

`verifyRecording(folder)` reports `valid` (no problems), whether Cria `ended`
cleanly, a torn tail, a count of lines, messages, operations and images, the gaps, and
unreferenced files. A torn last line, a gap, a missing `end` and unreferenced files
are not problems. These are: a line that does not decode, a referenced image
that is missing or whose size differs from the `size` its `oneBLOB` states (a
compressed `.z` payload states its size after inflating, so it is not compared),
a message count that skips (a deleted line), time running
backwards, and any line after a `gap` (other than `end`) or after `end`.

## Restarts and crashes

- **Cria restarts.** It gets a new `instanceId`, an empty ledger (operations, request IDs,
  bindings and recoveries, so no quarantine carries over), and an empty image
  folder. INDI drivers keep running and keep their state, so a camera that was
  exposing reads `exposing` and a capture settles `failed: busy`.
- **A driver crashes.** `indiserver` deletes its properties. Cria marks the device
  unavailable. An operation in flight ends `uncertain: driver-lost` and
  quarantines the device. When the driver is back and the device connected, it
  is set up again. Run `indiserver -r 0` so indiserver does not restart a crashed
  driver by itself. Cria never restarts a driver; the outside rig supervisor may,
  in the one narrow case AGENTS.md and docs/runtime.md describe.
- **`indiserver` goes away.** Every device is unavailable, in-flight work is
  uncertain, and the reconnect is paced. No command is resent after reconnecting.
- **SIGTERM.** Closing the process scope interrupts every Run. Their `stoppable`
  steps abort exposures and stop the mount and focuser before the process exits,
  and a mount's stop waits until it stands still (at most 20 s).
  `deploy/cria.service` allows 180 s (`TimeoutStopSec`), because a start-up
  connect can run uninterruptibly for `initializeTimeoutMs`.

## Image path

A capture enables BLOBs, sends `CCD_EXPOSURE` once, settles on the BLOB that
follows its own `Busy`, and disables BLOBs. The FITS payload (16-bit, row-major,
big-endian with `BZERO 32768`) becomes ASCOM ImageBytes v1 (Int32 image type,
UInt16 transmission, column-major, little-endian), because Vela's Alpaca adapter
decodes that format with the same code. The conversion is one byte swap plus a
typed-array transpose: 78 ms for a full 6248×4176 frame on thuban (Ryzen 3800X).
Decoding the 70 MB base64 BLOB takes about 250 ms. Expect about twice both on the
N150. The `.imagebytes` file goes into the rolling store with its SHA-256.

If a cancel arrives after the BLOB but before the operation returns, the run
settles `stopped` and Cria does not keep the frame. The camera is idle either way.

The store drops the oldest frames once the total passes `imageBudgetBytes`, and
never drops the newest. Linux keeps a deleted file readable through an open
handle, so a download that has started finishes. A request after the drop gets
`410 image-gone`. A download cut off by the client closes its file.

## Tests and verification

All tests run on thuban without hardware. Scenarios read as "given a rig state,
when Vela does X, then Cria reports Y", and assert literal values. Scenario tests
wait for a state (a fake device `Busy`, a reading, an operation settled) with a
deadline that names what they waited for, never for a fixed time. A test that
acts as another INDI client also waits until Cria's own `/v2/state` shows the
effect, because indiserver writes to each client in turn.

1. **Primitives, on Effect's TestClock.** Outcome precedence; `writeOnce` against
   every row of its table; the confirm deadline; `stoppable` interrupted
   mid-motion with a stop that confirms, fails and hangs; Run single flight and
   stop after settle; the exact `retryReads` pace; the quarantine fold. No real
   time passes.
2. **INDI boundary.** XML framing from recorded traffic split at random byte
   boundaries; entities; BLOB decode; `delProperty`; one client test against a
   real indiserver.
3. **Wire schemas and the ledger.** Every schema on literal inputs; the ledger's
   transitions on literal states.
4. **Wire and image boundaries.** The event stream with a fake ledger and faked
   interval timers (opening snapshot, 250 ms coalescing, the one-second cadence,
   a stuck subscriber dropped at 30 s, the 16-subscriber cap, a change during a
   snapshot build sent next); FITS conversion to exact ImageBytes and each
   refusal; the image store's cleanup, eviction and failed writes.
5. **Fake INDI server.** For cases simulators cannot produce: a driver that never
   acknowledges, one that answers `Alert`, a stop that never confirms, a
   connection dropped mid-exposure, a driver that disappears, a switch device,
   indi_asi_ccd's frame, binning, echo and hang (`zwoFrames`), the PPBA's
   dew duty under auto dew (`pegasusDew`), and the AM5 (`am5`): gotos refused
   until the site and time are written, a position published once a second and
   only when it changes, a stop acknowledged at once while the mount keeps going
   for 0.9 s and then decelerates, and the sidereal drift with tracking off. The
   EAF (`addEaf`): `FOCUS_MAX` 100000 against a position range of 0 to 60000,
   and `Alert` on a target outside that range.
   The fake answers from its own state, not from Cria's script. Here too: the
   HTTP refusals the typed client cannot send (token, origin, route, body), and
   SIGTERM to the real `main.ts` during a slew, which must abort the mount and
   wait until it stands still before the process exits.
6. **Real INDI simulators** (`indiserver` with `indi_simulator_ccd`, `_telescope`,
   `_focus`, `_weather` on a free port, one per test file). Capture and download;
   cancel mid-exposure ends `stopped`; focuser moves and a refused target that
   never reaches the driver; slew, tracking, a cancelled slew; readings stay fresh
   during an exposure; busy while another client exposes.
7. **errai, replayed.** The real drivers' recorded definitions against the deploy
   config.
8. **Source rules** (`testing/lint.test.ts`).

`pnpm golden` drives the scenarios in `testing/golden/scenarios.ts` through the
typed client against Cria on the fake INDI server, normalizes IDs, times and
durations, and compares the result with `testing/golden/wire.golden.json`. A
change to that file is a change to the wire. `node testing/mutate.mjs <file>
<search> <replace> <test files>` shows that the given tests guard a line.
`pnpm verify` (`verify.sh`) runs build, typecheck, the `dist/` check, the golden
and the full suite, and passes on a fresh clone. See "Verification" in
`ts/README.md`.

Vela's own client is not tested against TS Cria yet. The migration checklist
adds that test.

## Checked on errai (2026-10-15)

errai is the rig PC on Arch: indiserver with `indi_asi_ccd`, `indi_asi_focuser`,
`indi_lx200am5` and `indi_pegasus_ppba`, libindi 2.2.5. The check was read-only:
observer's `indi_getprop` dump, a recording of every definition (only
`getProperties` sent), and Cria running against errai with commands disabled,
behind a proxy that let only `getProperties` and `pingReply` through. All six
bindings came up ready with every supported reading current, aged at most 1.1 s.
The recording is `ts/apps/cria/test/fixtures/errai-2026-10-15.xml` (site latitude
and longitude zeroed), and `errai.test.ts` replays it to Cria running
`deploy/rig.errai.json`, with a replay that applies every write: Cria sets up the
2600 (`UPLOAD_MODE`) and the AM5 (site, then time) and nothing else.

What the real drivers have:

- Device names `ZWO CCD ASI2600MC Pro`, `ZWO CCD ASI220MM Mini`, `ZWO EAF`,
  `ZWO AM5` and `Pegasus PPBA`.
- ZWO gain and offset are `CCD_CONTROLS.Gain` and `.Offset`. `CCD_CFA` is RGGB at
  offset 0,0. Frames are 16-bit FITS. `CCD_COOLER` is write-only, so
  `indi_getprop` omits it, and Cria reads its value from the definition and
  updates.
- The AM5 reports `EQUATORIAL_EOD_COORD` (JNow) and has `ON_COORD_SET`, abort,
  track state and mode, park, `TELESCOPE_HOME.GO` and `TELESCOPE_MOTION_WE`. Its
  slew rates are named `1x` to `10x` but labelled with the true sidereal multiples
  `0.25x` to `1440x`. Cria parses the labels, because the names would be off by up
  to 144 times.
- The EAF has absolute position, `FOCUS_MAX`, temperature and abort.
- PPB Micro channels: 12 V master `POWER_CHANNELS.POWER_CHANNEL_1`; dew on and off
  `DEW_CHANNELS.DEW_CHANNEL_1` and `_2`; dew duty `DEW_DUTY_CYCLES.DEW_CHANNEL_1`
  and `_2` (0 to 100 %); auto dew `AUTO_DEW_CONTROL.DEW_CHANNEL_1`. All switches are
  AnyOfMany.

Measured with commands on the rig, with Chris present, on 2026-10-15:

- **`CCD_FRAME` is in unbinned sensor pixels.** The image is the frame divided by
  the binning. The 220MM at bin 2 gave a 960x540 image from a 1920x1080 frame,
  and a 480x270 image from a 960x540 frame.
- **A binning write recomputes the frame.** On the 2600, bin 2 turned a 6248x4176
  frame into 6240x4176. Back at bin 1 it still read 6240 until a frame write
  restored 6248.
- **The grid is in binned pixels.** The binned width must be a multiple of 8 and
  the binned height even. Captures showed it on both cameras. On the 220MM at
  bin 2, binned 480x270 and 472x270 gave images of that size. Binned width 476 (952
  sensor pixels, a multiple of 8 in sensor pixels) was first reported as
  `WIDTH=944`, then `CCD_FRAME` showed 952, and a 0.1 s exposure after it was
  still running after 60 s, until cancelled. Binned height 271 (542 sensor
  pixels) showed 542 and hung the same way. On the 2600 at bin 2, binned width
  3116 (6232) was first applied as 6224, so Cria reported `failed: rejected` "the
  driver applied WIDTH=6224", while the property read 6232 afterwards. 3120 was
  confirmed. The definition says none of this. `WIDTH` has `step="0"`.
  `deploy/rig.errai.json` sets `frameGrid` to `{ "width": 8, "height": 2 }` for
  both ZWO cameras.
- **`CCD_FRAME` cannot be trusted to show the frame the camera uses.** After a
  frame off the grid, the driver publishes the rounded frame, then the one asked
  for, and keeps using the rounded one. A binned width of 3124 at bin 2 on the
  2600 was confirmed. The fake reproduces that confirmation through the echo
  (inferred, not seen on the rig). The binning change had already rounded the
  frame to 6240, so the rounded report looked unchanged to Cria, and the echo
  read as the driver's answer. Cria therefore checks the grid before sending and
  does not rely on the readback to catch a rounded frame.
- **Correction.** This section first said the 2600 wants a width that is a
  multiple of 8 sensor pixels, from `WIDTH=3124` at bin 2 leaving the frame at
  6240. That frame is 1562 binned pixels, off the binned grid too, so it never
  told the two rules apart. The sensor-pixel rule let 952 at bin 2 through, and that frame
  hangs the next exposure. Why that write left the frame at 6240 rather than
  publishing a rounded 3120 is not known.
- **The PPBA's auto dew overrides a manual duty.** With
  `AUTO_DEW_CONTROL.DEW_CHANNEL_1` on, a `DEW_DUTY_CYCLES` write was accepted and
  set back to 0 within seconds. The driver defines one auto dew element,
  labelled "Auto Dew Control", against two duty elements, so the deploy config
  puts both dew duties under it.
- **The PPBA holds a duty in 255 steps.** 10 % applies as 9.8039 %.

Measured on the mount, with Chris present, on 2026-10-15 (the first physical run
of this Cria; Readings above every one):

- **A stop is not stationary when the driver says so.** A `mount-slew` from Dec
  70 to Dec 50 was cancelled 1.2 s in. Cria settled `stopped` at once and
  `EQUATORIAL_EOD_COORD` went `Idle` at once, but the mount moved about 3.6° more
  over about 2 s: Dec 61.21 at the abort, `Idle` 0.1 s later, 57.80 at 1 s,
  57.63 at 2 s. The position is published about once a second. The AM5 has a
  harmonic drive and slews at up to about 3°/s at its 9x and 6°/s at 10x. Cria
  now confirms a stop only when the mount stands still (see "Stopping the mount").
- **A rotate overshoots by its rate times 0.9 s.** `mount-rotate` +1° at 8x
  (0.2507°/s) travelled 1.23° (RA 24.72° to 25.95°), because the stop went out
  when the polled position passed the target. -1° came back the same way. Cria
  now leads the stop by rate × 0.9 s and reports the distance travelled.
- **The AM5 refuses every goto until its site and time are set.** It answered
  `:MS#` with `e7#`, which indi_lx200am5 reports as `Slew failed (-1)` and `Alert`
  on `EQUATORIAL_EOD_COORD`, so Cria saw `failed: rejected` "the driver reported
  Alert". After the raw `:St`, `:Sg`, `:SG`, `:SC`, `:SL` the goto was accepted.
  Cria had never written `GEOGRAPHIC_COORD` or `TIME_UTC`; the ZWO ASCOM driver
  on Windows never showed the problem. Cria now writes both after
  the mount connects (see "Device setup"); that the INDI writes are enough is not
  yet proven on the mount.
- **The 2600's `UPLOAD_MODE` was `UPLOAD_LOCAL`.** Cria refused its captures.
  Device setup now switches it to client.

Gaps that need a decision:

1. **The 2600 saves frames locally.** Resolved: device setup switches a camera
   on `UPLOAD_LOCAL` to `UPLOAD_CLIENT` after it connects (Chris, 2026-10-15).
2. **The AM5's clock is not set.** Resolved: device setup writes the site and the
   system clock's UTC after the mount connects (see "Device setup").
3. **No pier side.** Both `TELESCOPE_PIER_SIDE` switches are Off at the pole, so
   Cria reports `unknown`. Check again after unparking and slewing.
4. **EAF travel disagrees with itself.** Resolved: `FOCUS_MAX` is 100000, but
   `ABS_FOCUS_POSITION` allows at most 60000, and the tube is safe only from
   15500 to 38000 (Chris, 2026-10-15). Cria reports the smaller limits and
   refuses moves outside the configured window; `FOCUS_MAX` is left as it is
   (see "The focuser travel window").
5. **Cooler power range is 0 to 1** (step 0.2), while the wire calls it a percent.
   Check the scale while the cooler runs.
6. **Exposure limits.** The 2600 accepts at most 2000 s and the 220MM at most
   10 s. The wire allows 3600. Cria refuses longer requests before sending.
7. **Dew duty step is 10 %.** Cria accepts only multiples of the step. If 10 is
   only a UI step, the check is too strict for dew. The box itself holds 255
   steps, and Cria confirms within half a step and reports the value held.
8. **Not exposed by Cria yet:** the 2600's fan speed and anti-dew heater
   (`CCD_CONTROLS.FanSpeedAdjust`, `.AntiDewHeater`), the PPB's power sensors and
   adjustable output, and guide pulses.
9. **The AM5 has no `TIME_LST`, no `TELESCOPE_TRACK_RATE`, and no at-home
   indicator.** Sidereal time is computed, and the RA and Dec rate offsets read
   unsupported.

## Rules and known limits

- **No Cria captures on the guide camera while PHD2 is guiding.** Both use the same
  INDI driver and one exposure at a time. Cria would refuse with busy or, between
  PHD2 frames, interrupt guiding with its own exposure. Cria skips PHD2's frames
  but cannot coordinate with PHD2.
- **A cancel at the moment a short motion completes** can report `stopped` instead
  of `confirmed`. The mount is stationary either way and the stop was confirmed.
  Vela treats the motion as not done and may repeat it, which is safe because the
  device state is known.
- **Setup on a device someone disconnects at that moment.** Device setup is a
  `device-connect` operation, submitted only while the device reads connected.
  If someone disconnects it in the milliseconds between that reading and the
  operation's own, the operation connects it again before setting it up.
- **The request-ID map is never pruned.** Deleting a marker would let an old
  request ID run a second time. It grows by one entry per request for the life of
  the process.
- **Node 24 or later.** On Node 26 a file handle left to garbage collection is an
  uncaught error that ends the process without finalizers. Cria closes every
  image file explicitly.

## Open questions

1. **Setpoint readback.** Resolved: `setpointC` stays an unsupported reading, and
   `lastCommandedSetpointC` reports the last setpoint the driver acknowledged.
2. **Sidereal time.** If the AM5 driver has no `TIME_LST` (it does not, see gap 9),
   Cria computes it from the system clock (chrony) and the site longitude. Is a
   computed value good enough for polar alignment, or must it come from the mount?
3. **Axis motion rates.** Resolved for safety: Cria accepts only a rate the mount
   advertises (within 1 %) and reports the rate it used. Open: polar alignment's
   rotate step might be better as a slew to a computed RA. That needs a look at how
   Vela uses `mount-rotate`.
4. **ZWO property names.** Resolved against errai (see "Checked on errai").
5. **Liveness reads and other clients.** The 1 s `getProperties` definition is
   sent to PHD2 too. Expected harmless; confirm with PHD2 connected.
6. **Protocol 5.** Resolved: adopted with no compatibility layer (Chris,
   2026-10-15), with the shared schema in `@cria/wire`.
7. **Telemetry.** The .NET SQLite telemetry is dropped. Keep it dropped (journald)
   or bring back a small store?
8. **Effect version.** Pinned to 4.0.3 exactly, as a peer dependency of the shared
   packages. npm has 4.0.5.
9. **Private Cria, public Vela.** Vela installs `@cria/wire` from chrhicks/cria,
   which is private, while Vela is public. The options: make the Cria repo (or
   just these packages) public; give Vela's Docker build an SSH key or token (Vela
   then builds for no one else); or copy `dist/` into Vela at each bump.
10. **Availability and other clients.** A camera another INDI client is exposing
    reads `exposing` but stays `availability.ready: true`, so Vela learns it is
    busy only from the capture's `failed: busy`. Whether `availability` should
    show it is part of the open decision on availability precedence.
11. **Availability before the definitions settle.** `availability` turns ready on
    the first liveness read. A property that has not arrived yet reads
    `unavailable: not-read` for up to 2 s after connecting, and a command that
    needs it settles `failed: unavailable` before sending anything. Seen in the
    shutdown test, where Cria runs in its own process. The tests wait for
    `noneNotRead` as well. Whether `starting` should last until the definitions
    settle is part of the same open decision on availability.
