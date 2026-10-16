# Legacy: Cria .NET service on Windows

> Legacy. The TypeScript Cria on Linux with INDI is the norm, described in [runtime](runtime.md). This file keeps the .NET service's runtime and test notes as they were.

Cria runs beside the Windows rig drivers and provides shared observations and bounded equipment operations to remote clients. Vela keeps repetition, autofocus decisions, plate solving, previews, image analysis, FITS generation and scientific storage.

This is the main implementation direction. It is an API service without a dashboard. The earlier TypeScript service and narrow comparison prototypes are kept in ignored local archives for reference. The service has passed offline API checks and narrow actual-rig Vela capture, preview, export and saved-image checks with the installed drivers. Unattended startup, sustained observing and general production promotion remain unqualified. Historical trials do not establish current equipment ownership. See [testing and qualification limits](#physical-qualification).

## Components

- `Cria.Desktop`: a small native Framework 4.8 window for start/stop, device readiness, logs and connection settings. It uses the runtime already required by the workers; Vela remains the equipment interface.
- `Cria.Api`: ASP.NET Core 10 API, shared state, in-memory operations, a rolling set of recent images and diagnostic history. No vendor driver assemblies are loaded here.
- `Cria.Driver.Windows`: x64 .NET Framework 4.8 process using the official ASCOM toolkit, with a message-pumping single-threaded apartment (STA) owning each driver. The earlier physical trials established this runtime as the compatible path for both installed cameras.
- `Cria.Driver.Core`: local operation execution and driver-call admission, shared by the Windows worker and test fixture.
- `Cria.Contracts`: typed StreamJsonRpc contract. Named pipes carry observations, commands and progress. Original pixels move through complete local files, outside RPC.
- `Cria.Driver.Fixture`: separate-process deterministic test equipment. It never loads ASCOM and is excluded from the Windows package.

Each binding initially has its own worker. Bindings which share a vendor server or hardware transport must use the same `failureDomain`; that domain shares polling/write admission and is blocked together after a failure. This is a working grouping policy, not whole-rig qualification. A driver-call timeout retains ownership and blocks further calls, even if the underlying call later returns. Workers are never automatically killed, restarted or reconnected after uncertainty.

## Build and verify

Use .NET SDK **10.0.401**, Python, `uv`, and the repository's Node/pnpm development dependencies. `global.json` and NuGet lockfiles pin the build. Vela checks need its source checkout and installed dependencies; they import its actual types, image decoder and capture controller without modifying it.

```sh
pnpm install --frozen-lockfile
CRIA_DOTNET=/path/to/dotnet VELA_ROOT=/path/to/vela ./tools/check.sh
CRIA_DOTNET=/path/to/dotnet ./tools/publish.sh
```

The package is `artifacts/cria-dotnet-win-x64.zip`. It contains a self-contained .NET 10.0.12 API, the Framework worker and desktop launcher, configuration example, the ZWO setup-dialog helper scripts (`tools\windows`), API schema, instructions, dependency notices and a SHA-256 manifest. It excludes fixture tools, dashboard code, local data, tokens and real device configuration. Installed Framework/ASCOM/vendor dependencies remain prerequisites. Publishing does not deploy or take ownership of equipment.

## Windows startup

Extract the complete package into a separate directory. Copy `config/windows.example.json` to `config/local.json`, set verified driver ProgIDs and operational names, and choose explicit failure domains. Paths are relative to the configuration file. Supply `CRIA_TOKEN` as a private process environment variable with at least 32 characters, then run `start-cria.cmd` (or `start-cria.ps1`) in the foreground. The command launcher does not require changing PowerShell execution policy.

The example deliberately has `ownershipConfirmed: false`, `commandsEnabled: false`, and `connect: false`. Before setting ownership confirmation, stop the prior equipment owner and establish that the configured drivers are available for Cria. Ownership confirmation acknowledges even observation-only driver activation; disabling commands does not eliminate connection/setup side effects configured separately. `setupBeforeConnect` displays the vendor setup dialog in the same worker/driver instance; it is not unattended startup support.

Two deadlines apply to a driver. `callTimeoutMs` (up to 30 000) bounds each steady-state read, write and command. `initializeTimeoutMs` (default 120 000, 1 000 to 300 000) bounds the first connect and identity read of a device without a setup dialog, because a cold USB or serial driver can take much longer to connect once than any later call: on a cold boot the Pegasus devices took about 40 s and 82 s, and about 1 s when warm. Devices with `setupBeforeConnect` already get up to 300 s. Passing either deadline blocks the device for explicit recovery, because a timed-out driver call may still be running.

The supplied example does not take ownership from ASCOM Remote. Verify the current owner before every handoff and preserve its configuration and rollback path. Stop Cria cleanly, verify driver release and actual equipment state, then restore the prior owner. Do not treat closing the API, killing a worker, or deleting an ownership marker as proof that hardware stopped.

The default endpoint is `http://127.0.0.1:4319`. When `CRIA_TOKEN` is set (at least 32 characters), all routes except the minimal `/health` require `Authorization: Bearer …`. When it is not set there is no bearer check at all: use that only where the listen address is the access control, such as a private tailnet. Use a trusted private link or TLS reverse proxy for remote access. Set `publicOrigin` to the exact external origin when applicable. Tokens belong in Vela's server, not its browser. Cria does not register a Windows service, configure firewall rules, or modify vendor settings during installation.

## Equipment contract

[OpenAPI 3.1](../contract/openapi.json) is also served at `GET /v2/schema`. Version 2 intentionally differs from the prototype's version 1. There is no implicit v1 translation.

| Vela need            | Cria API behavior                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Inventory/readiness  | `GET /v2/state`, latest-state SSE at `/v2/events`, per-field timestamps/status/generation, explicit endpoint/device/name bindings    |
| Capture              | `capture`: one exposure, fresh-frame checks, local cancellation/completion, complete ImageBytes original                             |
| Camera configuration | `camera-configure`: geometry, binning, ROI, gain and offset validated before writes, then read back                                  |
| Cooling              | `cooling`: capability checks, setpoint/cooler writes and confirmed readback; current cooler/temperature/power facts                  |
| Focus                | `focuser-move` with explicit client travel window, positive target below MaxStep; `focuser-halt` with stationary readback            |
| Framing              | Geometry, pointing/site/frame/tracking facts; `mount-slew`, `mount-home`, `mount-tracking`, `mount-stop`                             |
| Alignment            | Pointing and capture plus `mount-axis` with local duration or `mount-rotate` with observed signed RA travel; local stop and readback |
| Other rig controls   | `mount-park`, `mount-unpark`, `device-connect`, and range/step-checked `switch-set`                                                  |

Observation RA and sidereal time are **hours**; slew RA and axis rates/travel are **degrees**. Coordinate-system values follow ASCOM: 0 other, 1 topocentric, 2 J2000, 3 J2050, 4 B1950. A slew must name the known frame actually reported by the driver; Cria does not guess or transform coordinates. Image pixels use ASCOM rank-two ImageBytes ordering; Vela's actual decoder is exercised by the contract tests.

Each reading carries `observedAt` for its last successful value, `checkedAt`/`readStartedAt` for the latest attempt, and `generation`. A failed read preserves the old value with `stale`; unsupported and unavailable facts remain explicit. Clients must check each required field, age, identity and generation. `commandReady` is a coarse admission indicator; it does not replace operation-specific driver validation. Cached metadata has a different age budget from dynamic state. Clients must also bound transport delay and clock uncertainty.

A write invalidates its entire failure domain. `POST /v2/devices/{id}/refresh` requests fresh reads; repeated pending requests coalesce. Reads begun before that generation cannot satisfy its refresh, including slow metadata reads. Follow `refreshPending` and the required fields. State SSE is a bounded latest-snapshot stream, not a lossless event log. Each connection immediately receives a newly generated full snapshot. Ordinary polling updates coalesce to at most one snapshot per second; operation, refresh and failure updates can arrive up to four times per second. Quiet streams send a comment heartbeat after about four seconds. Heartbeats prove transport liveness only and never refresh equipment facts. Each subscriber retains one pending notification, with at most sixteen subscribers. Reconnect has no replay: the snapshot contains blocking operations and twenty recent terminal operations; use bounded HTTP reconciliation for a missing operation. `generatedAt` is server wall time, not a guaranteed monotonic clock.

## Operation lifetime and cancellation

Submit `POST /v2/operations` with `instanceId`, a client-generated `requestId`, `deviceId`, `bindingId`, `expectedName`, `kind` and `parameters`. Preserve that complete request until admission is resolved. Cria remembers it, in memory for this service instance, before dispatch. Identical retries return the same operation; changed content returns 409. After the details of an old operation are dropped, its request marker returns 410 and never dispatches again. `GET /v2/requests/{instance}/{request}` recovers a lost admission response.

Query `/v2/operations/{id}` or follow state. Operations proceed independently of HTTP callers. `POST /v2/operations/{id}/cancel` requests cleanup; follow the eventual outcome. Cancelling an HTTP request is not equipment cancellation. If a camera cannot abort, Cria follows the existing exposure rather than claiming it stopped. A naturally completed capture may still succeed after a late cancellation request.

`elapsedSeconds` is the latest worker progress sample measured after the exposure
command returns, including completion or cleanup wait. It is nullable when no
sample was received and is not a measurement of shutter-open duration. Terminal
results retain the last received sample. A motion deadline can end as `failed`
with `settled: true` when the stop command and stationary readback were confirmed;
failed or unconfirmed cleanup remains uncertain.

Tracking writes are sent once, followed by fresh readback attempts every 100 ms
for up to 15 seconds (or the shorter configured operation timeout). This permits
an acknowledged driver change to become observable without repeating the command.
Read failures or an unconfirmed deadline still produce an uncertain, blocked result.

`uncertain` means equipment outcome was not established. `blocksDevice` remains true until explicit recovery. A restarted API starts with no operations: the new `instanceId` means anything in flight before it is unknown, and nothing is replayed (see [architecture](architecture.md#restarts)). It still discovers driver workers left by the previous instance and refuses to activate a device until that owner is confirmed gone. Process isolation protects API availability; it does not establish physical safety.

After the operator has externally settled the equipment and stopped the previous owner, call `/v2/devices/{id}/recover` with current `instanceId`, current `bindingId`, `externalRecoveryConfirmed: true`, and a short `note`. Recovery checks recorded PID plus creation time and refuses live prior owners. It removes matching dead-owner markers, clears the domain interlock and starts new bindings. Historical uncertain operations remain uncertain with a reconciliation record. Missing/corrupt ownership manifests require direct inspection; the API does not guess. Do not send this attestation merely to clear an error.

The desktop **Stop Cria** button uses the authenticated, loopback-only `/v2/service/stop` endpoint with the current instance ID. It refuses while equipment operations are active: finish or cancel them in Vela first. Accepted stop disables new admission, closes state and telemetry streams, and asks each worker to disconnect/dispose on its owning STA. Initialization, polling and final result handling finish before that owner's release. Workers have no inherited console; opening a vendor setup window does not opt a worker into console Ctrl+C broadcasts.

`service-exit.json` in the data directory records the service instance, process ID and unconfirmed devices. The desktop reports clean stop only when that receipt matches the process it observed and exit code is zero. Exit code 2 means one or more owners were unresolved. A timeout never authorizes killing workers or clearing markers. The console launcher still supports Ctrl+C; stop idle equipment first.

Release requires idle equipment, a successful synchronous client disconnect, driver disposal and owner-thread exit. It does not require `Connected` to become false: ASCOM defines that property as shared hardware state, so another client can legitimately keep it true after this client disconnects. See the [ASCOM interface specification, Connected notes](https://ascom-standards.org/newdocs/ascom-interfaces.pdf#page=262). Exceptions and deadlines still leave release unconfirmed. Closing Cria does not stop a shared vendor server or its other clients.

## Desktop installation and daily use

On Windows, run the installer from the extracted release, passing the **existing verified configuration and token file**:

```bat
install-cria.cmd C:\path\to\local.json C:\private\cria-token.txt
```

The installer is native code in the desktop executable; it does not require changing PowerShell execution policy. `install-desktop.ps1` is an optional wrapper for environments that permit scripts.

It creates a **Cria** desktop shortcut and per-user settings under `%LOCALAPPDATA%\Cria\Desktop`. The token is protected using Windows DPAPI for that user. The settings directory has restricted permissions. Existing settings, shortcuts and the target directory’s previous permissions are backed up; no token appears in shortcut arguments or logs. Keep the extracted release where it was installed. To roll back, restore the saved desktop settings/shortcut and select the earlier release/configuration after confirmed driver release.

Double-click Cria to start it. If the guide camera setup window appears, choose the verified guide camera by displayed name and press OK. Wait for every expected device to become ready, then use Vela. An already running ASCOM Remote Server, occupied port or locked data directory prevents a second start. Opening the same launcher twice keeps one supervisor. Closing its window requests the same controlled stop; active work keeps it open.

A person does not have to click the ZWO setup windows. `tools/windows/zwo-setup-select-both.py` (shipped in the release under `tools\windows`, together with the `zwo-setup-select.py` it imports) picks the camera and presses OK in one dialog, for a worker whose dialog is open: `python zwo-setup-select-both.py --pid <worker pid> --target "ASI2600MC Pro"` (or `"ASI220MM Mini"`). Find the pid with `Get-Process -Name Cria.Driver.Windows | Where-Object MainWindowTitle -eq 'ASICamera Setup V6.5.41'`, then match it to a device by `deviceId` in `workers\<id>\process.json` under the data directory. It presses OK only after checking that the dialog is the expected one, no message box appeared, the selection stuck and the Bayer label fits the camera; otherwise it exits without pressing anything. Run it as soon as a dialog appears, because a dialog left open past `CallTimeoutMs` makes that device fail startup with `Driver deadline exceeded`. It needs only Python 3 on the rig PC and sends window messages to that one process. It relies on the setup window of ZWO driver 6.5.41 and was used on the rig on 2026-10-13; it refuses any other window title.

A specific Tailscale/IP listen address remains restricted to that network address; the API also listens on loopback for local desktop control. It does not broaden to other network interfaces.

Settings can be changed while stopped: the connection port, local/network access (including preserving the current specific address), and whether opening the desktop app starts Cria. Unknown configuration fields are preserved, with a previous-file backup. This is **not automatic startup at Windows login**. The installer neither changes ASCOM Remote startup nor registers Cria at login. Any rig-owner startup change is an explicit, separately recorded migration step. The guide driver's current setup selection still needs an interactive dialog on each fresh worker.

Click **Stop Cria**, wait for confirmed release, then shut down Windows. The desktop blocks an ordinary Windows shutdown request while it knows Cria is running, asking you to stop Cria first. Forced Windows shutdown or power loss can bypass this; the next service start retains unresolved ownership for explicit recovery. Clean driver release does not itself prove a mount is parked, tracking is off or power outputs are off. Set the intended equipment state in Vela first.

The desktop writes a separate bounded log per service launch (at most 32 files, about 16 MiB each). Its UI uses the existing Framework runtime, without a browser or bundled equipment dashboard. The API stays independent of the UI; an unexpected desktop exit does not kill equipment processes.


## Storage and resource limits

Completed captures are kept in a rolling set in `recent-images/` under the data directory. `imageBudgetBytes` (default 10 GiB) is a soft cap: when the total passes it the oldest image is dropped, strictly oldest first. The newest image is always kept, and an image that is being downloaded is never dropped, so the set stays over the budget until that download ends and then the oldest goes. Nothing is promised across a restart: the folder is emptied at start. It is a folder of its own, so originals the older design kept under `images/` are left alone and can be deleted by hand. There are no receipts, no release call, no expiry and no refusal of a capture because the store is full.

Vela fetches an image right after its capture succeeds (`GET /v2/images/{id}/original`, repeatable while the image is held). An image that was dropped, or that this instance never held, returns **410 `image-gone`**. That frame is lost; nothing exposes again to repair it.

Expected reasons not to start exit with **code 3** and a `Cria refused to start:` message instead of crashing:

- invalid usage, or configuration that does not decode or lacks a required value (for example `"devices": null`, or a binding's `expectedName`);
- an unusable `CRIA_TOKEN`;
- a data directory already in use by another Cria.

Operations are kept in memory. The newest `retainedOperations` finished operations (default 1,000) keep their full details; older ones shrink to a small marker that still answers 410. Operations that have not finished, or that finished uncertain, are never dropped. At most `maxRequests` (default one million) requests are accepted per instance; reaching it stops new admission. A new API incarnation rejects requests that carry an old incarnation ID.

These software bounds do not define a whole-rig RAM budget. The dedicated 16 GB mini-PC must be assessed using sustained growth, headroom, responsiveness and reliability.

## Diagnostic history

Telemetry uses a separate bounded writer queue; equipment never waits for a telemetry disk write. It records observations, operation admission/outcome, driver failures and worker logs. Each operation also ends with one `operation-timings` event: `laneWaitMs` waiting for its failure-domain lane, `workerMs` in the worker call, `adoptMs` storing the image (capture only), `totalMs`, `retryingSamples` (progress samples, every 250 ms, in which the worker was retrying its camera reads), and `phases`, when each worker phase (`exposing`, `readout`, `retaining`) was first seen, also polled every 250 ms. Use it to see where a slow capture spends its time. `/v2/telemetry/status` reports queue drops, writer/maintenance errors, actual oldest/newest timestamps, and limits. Defaults are 256 MiB of event payload, one million rows and six-hour maximum age. **This does not guarantee six hours of retained history** at every event rate.

`/v2/telemetry/events` pages by durable cursor, with exact `type`/`device` and `since`/`until` timestamp filters. `/follow` supplies cursor-based SSE; `/export` produces bounded NDJSON at a fixed high-water cursor. Both report retention gaps. Export ends with a continuation record when complete or at its 100,000-event cap; an interrupted stream must be resumed from its last received cursor. At most four telemetry streams are active. The prototype's diagnostic-mode overrides and summaries are not v2 routes; the v2 contract documents the implemented diagnostic surface independently of its old dashboard.

## Testing the .NET service

Run from the repository root with the SDK selected by `global.json`, Python 3, `uv`, and Node/pnpm installed:

```sh
pnpm install --frozen-lockfile
CRIA_DOTNET=/path/to/dotnet VELA_ROOT=/path/to/vela ./tools/check.sh
```

`CRIA_DOTNET` defaults to `dotnet`. The runner exports it as `DOTNET` for Python helpers. `VELA_ROOT` defaults to a sibling `vela` checkout; select a Vela checkout that speaks Cria protocol 4, then run `pnpm install && pnpm build` there, because the check loads Vela's built packages and its server sources. Vela's own build typechecks those modules.  Node tools support these integration checks only; the deployed service has no Node dependency.

The runner builds the solution with locked NuGet dependencies, then executes:

| Check | Scope |
| --- | --- |
| `tests/smoke.py` | Equipment operation workflows, capture/original transfer and repeated requests |
| `tests/faults.py` | Worker crashes/hangs, API availability, stale observations and uncertain writes |
| `tests/edge_cases.py` | Cancellation, read freshness and operation edge cases |
| `tests/startup.py` | Expected startup refusals exit with code 3 and a message, never a crash signal: usage, configuration with null required values (`devices`, a binding's `expectedName`, `dataDirectory`), token, data directory in use, an unreadable or unsupported custody marker, and protocol 2 records that do not fully decode (wrong type, unknown state, unknown field, missing digest, ID not matching its file name). Each case hashes every data-directory file except the `service.lock` lease before and after and checks that no journal or worker was created |
| `tests/boundaries.py` | OpenAPI validation, request limits, bounded image storage and download behavior |
| `tests/telemetry.py` | Diagnostic cursors, retention, filtering, export and gaps |
| `tests/sse.py` | Latest-state streaming, coalescing, heartbeat and stream limits |
| `tests/operation_timings.py` | A capture and a cooling operation each end with an `operation-timings` event naming the lane wait, worker time, image storage time (capture only), retrying samples and phases seen |
| `tests/polling.py` | Two devices sharing a failure domain, with slow reads, are each observed at least every 1.8 s at a 1 s poll. Polls queue for the shared lane, so contention is latency rather than a skipped poll; Cria calls a reading stale after 3 s, so real cameras sharing a lane otherwise flicker |
| `tests/lifecycle.py` | Controlled stop, release and worker ownership |
| `tests/resources.py` | Synthetic full-size original transfer and API responsiveness |
| `tests/vela.py` | Paired check: Vela's own fixture script (`apps/server/scripts/check-cria-fixture.ts`) drives Vela's production client, adapter and routes against a real Cria fixture service, including capture and original transfer. Needs a built Vela checkout that speaks protocol 4. |
| `tests/vela_restart.py` | Paired check: one Vela client (`apps/server/scripts/check-cria-restart.ts`) captures, survives a real Cria restart (new `instanceId`) and captures again. A client that stays blocked after the restart fails. Same Vela checkout requirement. |

These services use random loopback ports, temporary credentials/data and only `Cria.Fixture.*` bindings. No ASCOM driver or physical equipment is contacted. The fixture runs in separate processes; cleanup targets fixture workers identified by their command lines. Reports under `tests/results/` and the `tests/.vela` source link are ignored.

The resource check's regression threshold is a test guard, not a product RAM budget. Linux fixture measurements do not establish Windows driver performance. Evaluate the dedicated 16 GB rig using sustained growth, headroom, responsiveness and reliability.

### Crash reporting on development machines

The checks deliberately end processes in several ways. Fixture worker faults use `Environment.Exit`, and API or worker crash cases use `SIGKILL`. Shutdowns use `SIGTERM`. None of these produces a core dump.

Current Cria binaries refuse expected startup conditions cleanly with exit code 3 (`tests/startup.py`).

`tests/containment.py` keeps that abort out of desktop crash reporting without changing any system setting:

- It reads `/proc/sys/kernel/core_pattern`. On Polaris this pipes to `systemd-coredump`, whose journal entry Omarchy's `omarchy-crash-watch` announces.
- `RLIMIT_CORE=0` does not help with a pipe: the helper still runs and journals the crash.
- For a pipe pattern the kernel skips the dump before starting the helper when the process has `RLIMIT_CORE=1` (`fs/coredump.c`, `coredump_pipe`, Linux 7.2). The kernel then logs only `RLIMIT_CORE is set to 1, aborting core`.
- The limit is set in the child process only and survives `exec` into the dotnet host.
- After a contained abort, `run_contained` fails the check if `systemd-coredump` journaled that PID anyway.
- With a socket (`@`) or unreadable `core_pattern` there is no process-local opt-out, so the baseline refusal is skipped and reported as `SKIP`.

For ad-hoc probes:

- Run any binary expected to abort through `containment.run_contained(cmd, timeout)`, never with a bare `subprocess.run`.
- Never start the protocol 2 baseline against a migrated store directly. For example, an older backup-rehearsal probe called `subprocess.run([DOTNET, V2.API, config])` on a migrated copy.
- Do not change global coredump or crash-reporter settings to quiet tests.

An unexpected crash of a current binary is deliberately not contained: it remains a visible failure.

### Windows package

```sh
CRIA_DOTNET=/path/to/dotnet ./tools/publish.sh
```

This creates `artifacts/cria-dotnet-win-x64.zip` from a fresh staging directory. It includes the self-contained Windows API, Framework worker and desktop launcher, startup scripts, the ZWO setup-dialog helper scripts, example configuration, OpenAPI schema, runtime/testing documentation, dependency notices and a SHA-256 manifest. It excludes fixture binaries, local configuration, tokens and data. Building it on Linux verifies compilation and packaging, not Windows COM behavior.

### Persistent browser fixture

After building, start a foreground fixture for Vela browser checks:

```sh
DOTNET=/path/to/dotnet python3 tests/serve_fixture.py
```

It waits for all five device kinds and prints a loopback URL and private connection-file paths. The new run directory, by default under `data/vela-fixture/`, contains `connection.json`, `vela-rigs.json` and `vela.env`. Load the token environment file into Vela's server process; the browser does not need it. Ctrl+C or SIGTERM closes the API and fixture workers and removes the active connection/token files. Logs and durable data remain for inspection. File presence alone does not establish liveness; check `/health`.

Use `--port`, `--width`, `--height` or `--directory` to choose the listener, image geometry or a new run directory. Existing directories are refused. The launcher never clears old ownership or silently recovers uncertain work.

Pixels are a deterministic ramp, not stars. They do not change with mount or focuser state. Temperature and weather are fixed; camera settings are metadata without a physical detector response. This fixture exercises capture, transfer, archive, command/readback and adapter behavior. It cannot qualify autofocus, plate solving, framing accuracy, polar alignment or physical equipment.

### Physical qualification

Earlier supervised trials exercised the installed cameras and Vela capture/export. Further qualification remains necessary for sustained observing, startup failures, physical in-flight failures, vendor executable behavior, operator recovery and whole-rig failure grouping. Guide startup currently needs interactive same-process camera selection. Unattended Windows Service/session-zero operation is unqualified.

Keep physical trial evidence distinct from deterministic contract checks. Confirm current equipment ownership and the intended trial before deploying or connecting. This file describes [startup](#windows-startup) and [recovery](#operation-lifetime-and-cancellation).
