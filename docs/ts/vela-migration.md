# Move Vela to Cria protocol 5

This checklist moves Vela's Cria client from protocol 4 (the .NET Cria) to
protocol 5 (the TypeScript Cria). The contract is
[SPEC.md, "The wire (protocol 5)"](SPEC.md#the-wire-protocol-5), and its
[Changed from protocol 4](SPEC.md#changed-from-protocol-4) table lists every wire
change. This file says where each one lands in Vela.

Every `path:line` below is in Vela at commit `cf31102` (main, "Align
@vela/alpaca on Effect 4.0.3 stable"). Each one was read at that commit. Paths
are relative to the Vela repo root. Line numbers drift once the first PR lands,
so search for the quoted code if a line has moved.

Protocol 5 has no compatibility layer. Vela on protocol 4 cannot talk to the
TypeScript Cria, and Vela on protocol 5 cannot talk to the .NET Cria. Switch the
rig and Vela together.

## Where Vela's Cria code is

- `packages/cria` (`@vela/cria`) is the client. `src/schema.ts` is a hand-written
  zod copy of the protocol 4 wire. `src/client.ts` derives freshness, follows
  operations and maps outcomes to errors. `src/events.ts` reads the event stream.
  `src/http.ts` does the requests and decodes them. `src/error.ts` holds the error
  classes. `test/fixture.ts` is a fake protocol 4 Cria that the server tests also
  use.
- `apps/server/src/cria` turns client results into Vela's equipment model:
  `equipment.ts` (commands), `provider.ts` and `readings.ts` (readings),
  `mount-control.ts` (the mount interlock).
- `apps/server/tests/cria-*.test.ts` are six server tests against
  `packages/cria/test/fixture.ts`.
- `apps/server/package.json:23` (`"@vela/cria": "workspace:*"`) is the only
  dependent of `@vela/cria`.

## 1. Add the shared packages

Cria owns `@cria/wire` (the protocol 5 schemas) and `@cria/primitives` (Outcome,
Reading, Quarantine). Both commit their `dist/`, so Vela installs them from a git
subfolder with no build step.

1. In `packages/cria/package.json`, add these lines to `dependencies`, with the
   same Cria commit in both:

   ```json
   "@cria/primitives": "github:chrhicks/cria#<commit>&path:/ts/packages/primitives",
   "@cria/wire": "github:chrhicks/cria#<commit>&path:/ts/packages/cria-wire",
   "effect": "4.0.3"
   ```

   `effect` is a peer dependency of both packages, and `@cria/primitives` is a
   peer of `@cria/wire`, so `@vela/cria` must list all three. `@vela/cria` has no
   `effect` today (`packages/cria/package.json:18-19` lists only
   `@vela/equipment` and `zod`).
2. Run `pnpm install`. The lockfile records the exact commit.
3. Run `pnpm why effect`. It must show only 4.0.3. Effect is already aligned:
   `packages/alpaca/package.json:21` pins `"effect": "4.0.3"`, and
   `pnpm-lock.yaml:1081` has the only version, `effect@4.0.3`. Two copies of
   Effect would break Schema and tagged-error checks across the seam.
4. Give Vela's Docker build (and any CI) read access to chrhicks/cria. The repo
   is private, and without credentials the install fails with
   `ERR_PNPM_GIT_FETCH_FAILED`. See SPEC open question 9.

To bump the pin later, merge the change in Cria, then replace `<commit>` in both
lines with the Cria merge commit, run `pnpm install`, and fix what `tsc` reports.
The two packages always use the same commit.

## 2. Replace the zod copy of the wire

`packages/cria/src/schema.ts` mixes Vela's own config with the protocol 4 wire.

1. Keep Vela's config schemas: `CriaDeviceKindSchema` (`schema.ts:25`),
   `CriaDeviceBindingSchema` (`schema.ts:29`) and `CriaClientConfigSchema`
   (`schema.ts:37`). They describe `cria.json`, not the wire. The config format
   does not change, because protocol 5 still takes `expectedName` in requests.
2. Delete the wire copies and import them from `@cria/wire` instead:
   `CriaCommandSchema` (`schema.ts:62`), `CriaOperationRequestSchema`
   (`schema.ts:154`), `CriaReadingSchema` (`schema.ts:165`), `CriaImageSchema`
   (`schema.ts:177`), `CriaOperationSchema` (`schema.ts:207`),
   `CriaDeviceSchema` (`schema.ts:244`), `CriaStateSchema` (`schema.ts:262`) and
   `CriaErrorSchema` (`schema.ts:276`). Their replacements are `Command`,
   `OperationRequest`, `Reading`, `Image`, `Operation`, `Device`, `State` and
   `ErrorBody`.
3. Delete `CriaRefreshSchema` (`schema.ts:281`). Protocol 5 has no refresh
   endpoint.
4. Change `http.json` (`packages/cria/src/http.ts:116`) to take an Effect Schema
   and decode with it instead of `schema.parse` (`http.ts:121`). Do the same for
   the error body (`http.ts:87`, `http.ts:141`) and the event data
   (`packages/cria/src/events.ts:132`). The checks for `z.ZodError` at
   `http.ts:102`, `http.ts:106` and `http.ts:153` become checks for a Schema
   decode failure.
5. Update the exports in `packages/cria/src/index.ts:24-49`. The server imports
   `CriaStateSchema` (`apps/server/scripts/check-cria-fixture.ts:5`) and the
   types `CriaDevice`, `CriaReading` and `CriaOperation`. Move those callers in
   the same PR rather than keeping aliases.

The protocol version check comes with the schema. `@cria/wire`'s `State` requires
`protocolVersion: 5`, where `schema.ts:264` has `z.literal(4)`.

## 3. Follow the operation lifecycle

A protocol 5 operation is a union on `state`. It is `waiting` (a halt queued
behind the operation it stops), `running`, or `settled`. Only `settled` has `outcome`, and
`outcome.kind` is `confirmed`, `failed`, `stopped` or `uncertain`. The flags
`settled`, `blocksDevice`, `cancelRequested`, `acknowledged` and `observation`
are gone.

1. **The terminal test.** `packages/cria/src/client.ts:120` is
   `return operation.status !== 'accepted' && operation.status !== 'running'`.
   Make it `operation.state === 'settled'`, so `waiting` is not terminal.
2. **The outcome mapping.** `client.ts:708-713` infers uncertainty from
   `operation.status === 'uncertain' || !operation.settled || operation.blocksDevice`.
   Match `outcome.kind` exhaustively instead. `uncertain` throws
   `this.uncertain`, `stopped` throws `CriaCancelledError`, `failed` throws
   `CriaOperationFailedError`, and `confirmed` returns. The messages at
   `packages/cria/src/error.ts:70` and `error.ts:86` read `operation.message`. Read
   `outcome.message` on `failed` and `uncertain` instead.
3. **The candidate guard.** `client.ts:593-597` keeps a polled operation only if
   it did not lose `cancelRequested`, did not go from `running` back to
   `accepted`, and did not lose `elapsedSeconds`. In protocol 5 an operation
   moves only forward (`waiting`, `running`, `settled`), and only halts wait.
   Replace the guard with "take the candidate unless it is `running` and the
   current one is `settled`".
4. **Cancel.** `client.ts:557` resends the cancel while
   `active.cancelRequested && !operation.cancelRequested`. Protocol 5 has no
   `cancelRequested` echo. Send the cancel once per operation and keep that fact
   in `active`.
5. **Read state.** `client.ts:550` and `client.ts:641` pass
   `interrupted ? 'retrying' : operation.observation`. Pass
   `interrupted ? 'retrying' : 'current'`. Whether the stream was interrupted is
   Vela's own state.
6. **Progress.** `onProgress` receives the operation (`client.ts:63`). At
   `apps/server/src/cria/equipment.ts:84-93` read `operation.progress.phase` and
   `operation.progress.elapsedSeconds`, and `operation.startedAt`, which exists
   only on `running` and `settled`. `phase` is now a closed list:
   `preparing`, `exposing`, `readout`, `retaining`. A capture is under way once
   `phase` leaves `preparing`.
7. **Results.** `equipment.ts:259` parses `operation.result` for the focuser
   position. Read `outcome.value.values.position` from a `confirmed` outcome.
   Vela sends no `camera-configure` or `switch-set` today (only
   `packages/cria/src/schema.ts` names them). If it does later, a
   `camera-configure` region is in binned pixels, as Vela's framing already
   assumes, and its `values` are the geometry the camera then holds. On the ZWO
   cameras the binned width must be a multiple of 8 and the binned height even.
   Cria refuses any other region as `failed: invalid` before sending, naming the
   nearest valid values, so Vela should round its framing to that grid. A dew duty
   is refused while its auto dew channel is on.
8. **The capture image.** `client.ts:817-819` checks `status`, `settled`,
   `blocksDevice` and `image`. Check `state === 'settled'`,
   `outcome.kind === 'confirmed'` and `outcome.value.image !== null`. At
   `client.ts:824`, drop `image.id !== validated.reservedImageId`.
   `reservedImageId` is gone, and `image.operationId !== validated.id` on
   `client.ts:822` already ties the image to the capture.
9. **The mount interlock.** `apps/server/src/cria/mount-control.ts:27-29` refuses
   while `!device.commandReady`, or while an operation in the failure domain
   `blocksDevice` or is unsettled without `reconciliation.externalRecoveryConfirmed`.
   Use the device's `availability.ready` and `quarantine.held`, plus "an operation
   in the domain is not `settled`". Protocol 5 renames `reconciliation` to
   `recovery { at, note }`, and only an uncertain operation has one.

## 4. Read Readings as Cria decides them

A protocol 5 Reading is `fresh`, `stale`, or `unavailable` with a `reason`
(`not-read`, `unsupported`, `failed`), and has one `observedAt`. Cria decides
freshness. The device's readings are `readings`, typed per kind, not `fields`.

1. **Delete the freshness derivation.** `packages/cria/src/client.ts:290-316`
   checks the read barrier, `blocked`, `refreshPending`,
   `status !== 'current'`, `generation`, the order of `readStartedAt`,
   `observedAt` and `checkedAt`, and an age budget from `readStartedAt`. Keep the
   `blocked` check (now `quarantine.held`) and replace the rest with
   `reading.status === 'fresh'`. The timing options `dynamicMaxAgeMs` and
   `metadataMaxAgeMs` (`client.ts:51-52`, `client.ts:110-111`) then have no use.
2. **Keep the snapshot's own age.** Cria's freshness is as of `generatedAt`. A
   snapshot that stops arriving says nothing about now. Keep the stream checks in
   `packages/cria/src/events.ts:137-152` (backwards `sequence` or `generatedAt`,
   and `transportMs` against `maxStateRoundTripMs`) and the snapshot deadline at
   `client.ts:574-575`.
3. **Rename `fields` to `readings`, and `unsupported` to
   `status === 'unavailable' && reason === 'unsupported'`.** The sites are
   `apps/server/src/cria/readings.ts:61`, `readings.ts:84`, `readings.ts:96`,
   `readings.ts:121` and `readings.ts:132`, and `client.ts:337` and
   `client.ts:339`. Every other reading key Vela reads has the same name in
   protocol 5.
4. **Read names, not ASCOM integers.**
   - Camera: `provider.ts:296` reads `state` as an integer from 0 to 5 into
     `cameraStates` (`provider.ts:31`). Protocol 5 has `activity`, `idle` or
     `exposing`.
   - Mount frame: `readings.ts:108` reads `coordinateSystem` as 0 to 4 into
     `frames` (`readings.ts:5`). Protocol 5 has `topocentric` or `j2000`.
   - Tracking rate: `readings.ts:115` reads 0 to 3 into `trackingRates`
     (`readings.ts:7`), which includes `king`. Protocol 5 has `sidereal`,
     `lunar` or `solar`.
   - Pier side: `readings.ts:122` reads -1 to 1. Protocol 5 has `east`, `west`
     or `unknown`.
5. **Drop `atHome`.** `provider.ts:331` and `provider.ts:339` read it. Protocol 5
   removed it (it was always unsupported).

## 5. Use availability, quarantine and the device name

1. **`availability` replaces `commandReady` and `health`.** `provider.ts:184`
   computes command-ready from `commandsEnabled`, `device.commandReady` and
   `!device.refreshPending`. Use `device.availability.ready`, and show
   `availability.message` when it is false. `provider.ts:194` records
   `device.health` as a trace attribute; record `availability.reason` instead.
2. **`quarantine` replaces `blocked` and `reason`.** The sites are
   `provider.ts:170-172`, `client.ts:292`, `client.ts:332-333` and
   `client.ts:361-363`. Read `quarantine.held` and `quarantine.reason`.
3. **The device's INDI name is `name`.** `client.ts:225` compares
   `device.expectedName` with the binding's `expectedName`. Compare `device.name`.
   Requests still send `expectedName`.
4. **One `bindingId` per failure domain.** `client.ts:237` keeps a binding per
   device. That still works, because each device reports its domain's binding. A
   recovery changes the binding of every device in the domain at once.
5. **`sequence` counts snapshots per rig.** `GET /v2/state` and the event stream
   share the counter, so the stream skips numbers when someone reads the state.
   `events.ts:137` already rejects only a backwards `sequence`, and
   `events.ts:141` ignores a repeat, so this needs no change.

## 6. Replace the read barrier with `afterOperation`

Protocol 4 had `observationGeneration`, `refreshPending` and
`POST /v2/devices/{id}/refresh`. Protocol 5 has `afterOperation` per device, the
ID of the latest settled operation in the device's failure domain that every
fresh reading on the device postdates.

1. Delete the barrier map and its uses: `client.ts:138`, `client.ts:290` and
   `client.ts:409`.
2. Delete `refresh()` (`client.ts:392-401`). Nothing in `apps` calls it.
3. After Vela's own operation settles, wait until each device it reads shows
   `afterOperation === operation.id` before it treats the readings as the
   result. This replaces "generation greater than the barrier".
4. `provider.ts:129-150` (`awaitingRefresh`) keeps the last accepted view while
   the reason is `refresh-pending` or `barrier` (`provider.ts:132`). Key it on
   `availability.reason === 'refreshing'` instead. Its tests start at
   `provider.test.ts:324` and `provider.test.ts:356`.

## 7. Show the commanded cooling setpoint

INDI reports the sensor temperature, not the target. So `readings.setpointC` is
always `unavailable: unsupported`, and the camera has
`lastCommandedSetpointC: { value, commandedAt } | null`, the last setpoint the
driver acknowledged.

1. `equipment.ts:302-306` confirms a cooling command by reading `setpointC` back
   within 0.15 °C. In protocol 5 that check always fails, as `not-confirmed`.
   Cria already confirms the setpoint before it settles the operation `confirmed`.
   Compare `lastCommandedSetpointC.value` with the command instead, and stop
   reading `setpointC` (`equipment.ts:328`, `equipment.ts:339`).
2. `provider.ts:308` and `provider.ts:315` copy `setpointC` into the cooling
   view, and `apps/server/src/capture/routes.ts:77-78` copies it on. Fill it from
   `lastCommandedSetpointC.value`.
3. The web already labels the value as requested
   (`apps/web/src/features/capture/CaptureCooling.tsx:141-144`, "Requested").
   `apps/web/src/features/capture/PreparationCooling.tsx:35` compares the sensor
   temperature with it, and `apps/web/src/features/capture/use-capture.ts:84-85`
   treats its presence as confirmation. Both stay correct if the value is the
   commanded setpoint.

## 8. Slew only in a frame the mount reports

Protocol 5 accepts `coordinateSystem` `topocentric` or `j2000` for `mount-slew`.
Any other frame is `400 request-error`, and a frame other than the mount's own
settles `failed: invalid`. Cria never converts frames.

1. `equipment.ts:217` refuses only `unknown` and `other` before it sends. Refuse
   everything but `topocentric` and `j2000`. Nothing at the send site stops
   `j2050` or `b1950` today, because protocol 4 accepted them
   (`packages/cria/src/schema.ts:105`).
2. Leave `packages/equipment/src/framing.ts:1` (`CoordinateSystem`) as it is.
   The Alpaca adapter shares it.
3. The callers already narrow to `j2000` or `topocentric`
   (`apps/server/src/targets/routes.ts:110` and `routes.ts:480`), so no route
   changes.

## 9. Handle the closed error codes

Protocol 5 errors are `{ error: { code, message }, instanceId }`, with `code`
from the closed `errorCodes` list in `@cria/wire` and one HTTP status per code
(see SPEC "Errors").

1. `client.ts:872` turns `410 image-gone` into `CriaImageGoneError`. That stays.
2. A malformed image ID now answers `404 not-found` (protocol 4: 410). Vela
   builds image URLs from a validated `image.original.url`, so it never sends one.
   No change.
3. `client.ts:489`, `client.ts:503-506`, `client.ts:613` and `client.ts:635`
   switch on 404 and 410. The statuses for those routes are unchanged.
4. `packages/cria/src/error.ts:16` retries 429. In protocol 5, 429 is only
   `too-many-subscribers` on the event stream. Keep it.

## 10. Stops, cancel and recovery

Vela stops equipment by cancelling its own operation, never by submitting
`mount-stop` or `focuser-halt`. `equipment.ts:145-146`, `equipment.ts:233` and
`equipment.ts:266` call `client.cancelDevice` (`client.ts:777-793`). Only
`packages/cria/test/client.test.ts:262`, `client.test.ts:447` and
`client.test.ts:467` submit `mount-stop`.

What protocol 5 does, and what it means for Vela:

- **Cancel of a running motion or setting** asks Cria to stop it and returns the
  operation as it is (`202`). The outcome says what happened. It is `stopped`,
  `confirmed` if the work finished first, or `uncertain` if the stop was not
  confirmed. Vela already waits for the outcome.
- **Cancel of a halt** returns it unchanged, and the halt still runs. A stop is
  never cancelled. Vela submits no halts in product code.
- **A repeated stop** waits behind the running one, runs, sends the abort again,
  and settles `confirmed`. Protocol 4 settled the second one `failed: busy`
  without sending it. `client.test.ts:447` expects `status` `succeeded`, which
  becomes `outcome.kind` `confirmed`.
- **Recovery** (`POST /v2/devices/{id}/recover`) is refused `409 device-busy`
  while any operation is open in the domain. A successful recovery mints a new
  `bindingId` for every device in the domain. Vela has no recovery call today. If
  it adds one, it must read the state again before its next command.

## 11. The event stream has no heartbeat

Protocol 5 sends a state snapshot at least once a second and no `: heartbeat`
comment. Vela's client aborts and reconnects after `eventIdleTimeoutMs` (10 s,
`client.ts:113`) without a complete event (`events.ts:122-125`), and any complete
event, comment or state, resets that timer (`events.ts:230-232`). The one-second
cadence keeps a live stream far inside the 10 s window, so the parser needs no
change.

The heartbeat tests (`packages/cria/test/events.test.ts:188`,
`events.test.ts:199`, `events.test.ts:256`) test protocol 4 behaviour. Delete
them, or keep them as tolerance for comments; SSE allows comments.

## 12. The focuser travel window

`equipment.ts:250-257` sends `position`, `minPosition` and `maxPosition`.
Protocol 5 keeps the window and refuses a position outside it, as protocol 4
did. Only the result changes (step 3.7).

Cria now also has a configured travel window per focuser (SPEC.md, "The focuser
travel window"). On errai the EAF is safe only from 15500 to 38000, while its
driver says 0 to 60000 and `FOCUS_MAX` says 100000. Cria reports the usable
window and refuses a target outside it as `failed: invalid` before moving.

1. **`maxStep` is the usable top.** It is the smallest of `FOCUS_MAX`, the
   position's maximum and the window's `max` (38000 on errai, where protocol 4
   said 100000). Vela reads it at `equipment.ts:244` and
   `apps/server/src/cria/provider.ts:350`; no code change, only the value.
2. **Read the new `minStep`.** The lower end of the usable window (15500 on
   errai). Add it next to `maxStep` at `equipment.ts:244` and `provider.ts:350`
   (`r.integer('minStep', 0, 2147483647, true)`).
3. **Plan autofocus inside it.** `apps/server/src/autofocus/walk.ts:53` uses
   `MECHANICAL_END_MARGIN` (1) as the lower end, so a walk started near 15500
   plans positions Cria refuses, and the run fails mid-walk. Pass `minStep` to
   `planStarHfrWalk` and use `minStep + MECHANICAL_END_MARGIN` there, in
   `assertCommandedPosition` (`walk.ts:88`), and in the step guard at
   `walk.ts:138`; the controller passes the focuser's status at
   `apps/server/src/autofocus/controller.ts:222`. Do the same for the preview at
   `apps/web/src/features/autofocus/window.ts:21` (`low < 1`), and show
   `minStep` beside `maxStep` (`apps/web/src/routes/autofocus.tsx:216`). Both
   ends are allowed by Cria, so the existing one-step margin is safe, not needed.
4. **A focuser outside the window** (moved by hand) can be moved toward the
   window and no further away. `walk.ts:56` already refuses to start an
   autofocus at a limit; with `minStep` it refuses one outside the window too.

## 13. Fields that are gone

Delete every read of these. The steps above cover the ones Vela reads.

- Operation: `status`, `settled`, `blocksDevice`, `cancelRequested`,
  `acknowledged` (`schema.ts:223`, set by `packages/cria/test/fixture.ts:288`),
  `observation` (`schema.ts:227`), `message`, `result`, `image`,
  `reservedImageId` (`schema.ts:230`), `completedAt`, the flat `phase` and
  `elapsedSeconds`, and `reconciliation`.
- Reading: `checkedAt`, `readStartedAt`, `generation`, `message` outside
  `unavailable`, and the statuses `pending`, `current`, `unsupported` and
  `error`.
- Device: `fields`, `expectedName`, `health`, `commandReady`, `blocked`,
  `reason`, `observationGeneration`, `refreshPending`.
- Readings: camera `state`, `sensorType`, `bayerOffsetX`, `bayerOffsetY`,
  `canStopExposure`; mount `atHome`; the integer encodings of `pierSide`,
  `trackingRate` and `coordinateSystem`.
- Image: `preview`.
- Endpoints: `POST /v2/devices/{id}/refresh`, `/v2/schema`, `/v2/service`,
  `/v2/service/stop`, `/v2/telemetry/*`.

## 14. Move the tests

1. **Rewrite the fake Cria.** `packages/cria/test/fixture.ts` (349 lines) builds
   protocol 4 shapes: readings with `generation` and `status: 'current'`
   (`fixture.ts:43-53`), `protocolVersion: 4` (`fixture.ts:98`), operations with
   `acknowledged`, `blocksDevice` and `reservedImageId` (`fixture.ts:277-298`),
   and cancel through `cancelRequested` (`fixture.ts:322-328`). Type every
   response it returns with `@cria/wire`, so the compiler rejects a shape Cria
   would not send. The six `apps/server/tests/cria-*.test.ts` files import it.
2. **Update the client tests.** `packages/cria/test/client.test.ts` tests the
   freshness derivation (`client.test.ts:62`, `client.test.ts:88-91`), which
   step 4 deletes. Delete those cases. `client.test.ts:623` refuses protocol 3.
   Make it refuse 4.
3. **Update the server tests** that set protocol 4 fields:
   `apps/server/src/cria/provider.test.ts:61` (`protocolVersion: 4`), and
   `apps/server/tests/cria-mount-control.test.ts`,
   `cria-cancellation.test.ts`, `cria-required-readings.test.ts` and
   `cria-alignment-recovery.test.ts`.
4. **Replay the Cria golden through Vela's client.** Cria's
   `ts/testing/golden/wire.golden.json` is every response of 34 scenarios (every
   operation kind, the refusals, cancel, stop pre-emption, an unacknowledged
   command and its recovery, image download) in request order. IDs, times,
   durations and sequences are placeholders (`<operation-1>`, `<time>`,
   `<elapsed>`, `<sequence>`). Add a Vela test that substitutes fixed valid
   values for the placeholders, serves each scenario's responses from a fake
   HTTP server in order, and drives `CriaClient` through the same requests. The
   golden is not in the `@cria/wire` package, so copy it from the pinned commit
   (`git show <commit>:ts/testing/golden/wire.golden.json`) at each pin bump.
5. **Retire the protocol 4 scripts.** `apps/server/scripts/check-cria-fixture.ts`
   needs the .NET Cria's `serve_fixture.py` (`check-cria-fixture.ts:18`), and
   `check-cria-restart.ts` follows the .NET `tests/vela_restart.py`
   (`check-cria-restart.ts:10`). Point them at TS Cria on the fake INDI server,
   or delete them.

## 15. Update Vela's docs

- `packages/cria/README.md:3` calls Cria the ".NET v2 service",
  `packages/cria/README.md:13` describes heartbeat comments, and
  `packages/cria/README.md:43` requires protocol 4.
- `docs/architecture.md:15` describes Cria as a .NET 10 API with workers.
- `docs/local-tracing.md:118-126` names the reading reasons `too-old`,
  `refresh-pending` and `barrier`, which step 4 and step 6 remove.

## 16. Device setup, stops and rotates on the AM5

What changed after the first run on the mount (SPEC.md, "Device setup" and
"Stopping the mount"), and what Vela must do. Paths are at Vela `cf31102`.

1. **Start-up setup operations.** After a camera or mount connects, Cria runs
   its setup as a `device-connect` operation with request ID `startup-…`, and the
   device's availability is `starting` ("Waiting for device setup") until it has
   run. Vela did not submit these, so it must not follow or cancel them; it
   follows its own operations by ID already. `afterOperation` can name one; Vela
   waits for its own operation's ID, so nothing changes there. Show
   `availability.message` as step 5 says.
2. **Stops take longer.** A mount stop now settles only when the mount stands
   still: about 1.5 s for a still mount, a few seconds after a fast slew, at most
   20 s, then `uncertain: stop-not-confirmed`. `client.cancelDevice`
   (`packages/cria/src/client.ts:777`) and `equipment.ts:143-148` (`abort`) must
   wait at least that long for the outcome.
3. **The polar alignment sweep.** `apps/server/src/alignment/physical.ts:239-256`
   asks `mount-rotate` for `54 - probeTravel` degrees and accepts 54° to 60°.
   That only worked because the old rotate overshot. Cria now halts the axis early
   by rate × 0.9 s, so the mount stops near the distance asked, give or take its
   rate times about 1 s, and half the sweeps would end under 54°. Ask for the
   middle of the corridor (`57 - probeTravel`) and check the outcome's
   `travelledDegrees`, the RA travel Cria measured once the mount stood still,
   rather than a reading taken after `settle`. The rate must also be one the
   mount advertises (`primaryAxisRates`): `westRate` is ±1°/s
   (`physical.ts:235`), which the AM5 does not offer, so Cria refuses it before
   moving. Its 9x is 3.008°/s. A rotate whose lead is more than half its distance
   is refused `failed: invalid`, which a 54° sweep never is.
4. **A refused goto names its cause.** When the AM5 refuses a goto because its
   site and time are not set, the outcome is `failed: rejected` with a message
   saying so and what Cria sent. Show the message; there is nothing to parse.

## Order of the Vela PRs

Each PR is small and ends in a check that passes before the next one starts.

1. **Dependencies.** Add `@cria/primitives`, `@cria/wire` and `effect` to
   `packages/cria` (step 1). Nothing imports them yet. Check: `pnpm install`,
   `pnpm why effect` shows only 4.0.3, and the Docker build installs from
   chrhicks/cria.
2. **Dead code.** Delete `refresh()` and `CriaRefreshSchema` (step 6.2), and
   refuse `j2050` and `b1950` before sending (step 8). Both are correct on
   protocol 4 too. Check: Vela's tests pass.
3. **The wire, client and fake together.** Replace the zod wire (step 2), the
   lifecycle (step 3), readings (step 4), device fields (step 5), the barrier
   (step 6), and errors (step 9) in `packages/cria`, with `test/fixture.ts`,
   `client.test.ts` and `events.test.ts` rewritten (step 14.1, 14.2, step 11).
   This PR is large because the schema, the client and the fake cannot change
   one at a time. Check: `tsc` and the `packages/cria` tests pass, and the
   golden replay (step 14.4) passes.
4. **The server.** `equipment.ts`, `provider.ts`, `readings.ts`,
   `mount-control.ts`, the alignment sweep and the autofocus window (steps 3.6
   to 3.9, 4.3 to 4.5, 5, 6.4, 7, 12, 16), with
   `provider.test.ts` and the six server tests (step 14.3). Check: Vela's full
   test suite passes.
5. **Scripts and docs** (steps 14.5 and 15). Check: the scripts run against TS
   Cria on the fake INDI server, or are gone.
6. **On the rig, with Chris present.** Deploy TS Cria on errai and Vela on
   protocol 5 together. Check: readings only first, then one short dark capture,
   a small focuser move, tracking on and off, and a cancelled slew (see
   `ts/README.md`, "Before trying it on the rig").
