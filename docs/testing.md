# Testing

Every test of the TypeScript Cria runs without hardware. A test talks to a fake INDI server, to an `indiserver` with simulator drivers that the test starts on a free port, or to a recording of errai's INDI definitions. No test connects to errai or to any device.

You need Node 24 or later, pnpm, and libindi with its simulators (`indiserver`, `indi_simulator_ccd`, `indi_simulator_telescope`, `indi_simulator_focus` and `indi_simulator_weather`).

## Run every check

```sh
cd ts
pnpm install
./verify.sh
```

`pnpm verify` runs the same script. `verify.sh` runs five stages in order: build, typecheck, the committed `dist/` check, the wire golden, and the full suite. It prints `pass` or `FAIL` per stage and exits with the failing stage's exit code. It takes about 2 minutes.

Read the exit code of `./verify.sh` itself. Do not pipe it into `tee` or `tail`. A pipe once reported a failing suite as passing, because a pipe returns the exit code of its last command.

## What each layer proves

The suite asserts literal values. Scenario tests wait for a state with a deadline that names what they waited for, never for a fixed time. [SPEC.md, "Tests and verification"](ts/SPEC.md#tests-and-verification) describes each layer in full.

| Layer | Files under `ts/` | What it proves |
| --- | --- | --- |
| Primitives | `packages/primitives/src/*.test.ts` | `writeOnce`, `confirm`, `stoppable`, `retryReads`, Run and the quarantine fold behave as SPEC says, on Effect's TestClock with no real time |
| INDI boundary | `packages/indi/src/*.test.ts` | XML framing from recorded traffic split at random byte boundaries, BLOB decoding and `delProperty`, plus one client test against a real `indiserver` |
| Wire schemas and the ledger | `packages/cria-wire/src/*.test.ts`, `apps/cria/src/operation/*.test.ts` | Every protocol 5 schema on literal inputs, and every ledger transition |
| Wire and image boundaries | `apps/cria/src/wire/sse.test.ts`, `packages/fits/src/*.test.ts`, `apps/cria/src/image/*.test.ts` | The event stream's cadence, coalescing and subscriber limits, the FITS to ImageBytes conversion, and the rolling image store |
| Fake INDI server | `packages/fake-indi` (the server), `apps/cria/test/drivers.ts` (the rig's drivers on it) and the scenario tests beside them | Failures a simulator cannot produce: a driver that never acknowledges, a stop that never confirms, a dropped connection, a driver that disappears. Also the HTTP refusals, and SIGTERM during a slew aborting the mount before the process exits |
| indi-replay | `packages/indi-replay/src/*.test.ts` (against raw TCP clients and a hand-driven clock), `testing/replay.test.ts` (the real Cria on a recording the simulators made) | The tape loader, the exposure machine, writes and pins, stops and refusals, the frame cursor and sidereal time, each fault; the real Cria's captures matching the recorded ImageBytes digests, the hour angle, abort, the end of the recording and liveness |
| INDI simulators | `apps/cria/test/simulators.test.ts`, started by `testing/indiserver.ts` | Capture and download, cancel mid-exposure, focuser moves, slews and tracking against real INDI drivers |
| errai, replayed | `apps/cria/test/errai.test.ts` | Cria running `deploy/rig.errai.json` against the real drivers' recorded definitions (`apps/cria/test/fixtures/errai-2026-10-15.xml`) |
| Source rules | `testing/lint.test.ts` | Catches, `try`, `.catch(`, `Date.now()` and timers appear only at counted, reasoned sites, and `verify.sh` stays strict and pipe-free |
| Shipped packages | `testing/dist.test.ts` | The committed `dist/` of `@cria/primitives`, `@cria/wire` and `@cria/fits` matches a fresh build |

To run the suite without the other stages, run `pnpm test` in `ts/`. It starts its own `indiserver` processes on free ports.

## Keep the fake and the replay the same as indiserver

`packages/fake-indi` and `packages/indi-replay` stand in for `indiserver`, so what they deliver is measured against the real one, not assumed. Python scripts under `packages/fake-indi/measure/` and `packages/indi-replay/measure/` start a real `indiserver` (libindi 2.2.5) on a free loopback port with the INDI simulators (CCD, focuser, telescope, weather) or with a scripted driver, connect clients, and write what each client received into a JSON file under `src/`. The tests replay the same steps against the fake or the replay and compare. The files are committed, so CI needs no libindi; re-run a script after a libindi upgrade or when a new case needs measuring (each script's header says how).

- `measure-routing.py` and `measure-blob-scope.py` (fake): which clients each kind of driver output reaches, for every client setup and every sequence of up to three `getProperties` and `enableBLOB` commands over two devices, and exactly what they receive, `message` attributes and standalone `<message>` elements included.
- `measure-definitions.py` (replay): three observers' view of the four simulators through a recorded session that includes writes the drivers reject, a limit change and a device disconnecting and connecting, and through clients that write numbers outside their limits and switch vectors that break their rule, and ask for the telescope again (a driver may set a property inside its answer). `equivalence.test.ts` compares every attribute and value of every element the replay delivers with the real ones, and then feeds both to Cria's own client and compares what it sees. Anything not compared is named in the test, with the reason.

## Cases from recorded failures

Every Cria session on errai records its INDI traffic (`~/cria-recordings`). The failures the rig really produced are cases on the fake INDI server, so Cria and Vela can be tested against them without the rig. A case is the drivers' words from the recording: the same properties, states and order, and timing within the recorded timing. Driver behaviours live in `apps/cria/test/drivers.ts`, each with a comment that cites the date and the device (no site values: the fixtures carry no coordinates, offsets, serial numbers or personal data). The fake server's protocol is still measured against `indiserver` as the next section says; these cases are drivers' behaviour on top of it. A case marked *derived* was **not** recorded: the recordings hold no real failure of that kind, so it is the closest behaviour built from the recorded words, and its test says so.

| Case | Source | Behaviour (`drivers.ts`) | Test, with the real Cria |
| --- | --- | --- | --- |
| A stop during Home: the driver acknowledges the abort, leaves `TELESCOPE_HOME` Busy for good, the mount coasts about 2 s, the coordinates are Idle throughout | recorded, mount, 2026-10-26 and 2026-10-27 (three times) | `moveMount({ ignoreAbortFor })`; `am5` (the home model; `homeStaysBusyAfterAbort` defaults to true) | `home-stop.test.ts`, `recorded-mount.test.ts`: stopped, nothing held |
| Bias frames: the driver ignores the requested time and exposes for its minimum | recorded, ZWO ASI2600MC Pro, 2026-10-26 | `biasAtMinimum` | `capture-bias.test.ts` |
| Mount power cut mid axis motion: serial errors once a second, the coordinates Alert and frozen, a stop answered by Alert and `Error stopping W/E motion.` | recorded, mount, 2026-10-29 evening | `am5(...).cutPower()` | `recorded-mount.test.ts`: uncertain `stop-not-confirmed`, mount held, the motion written once |
| An axis motion at Home (Dec 90) answered Idle after 41 ms, never Busy | recorded, mount, 2026-10-30 evening; once in 92 starts | `am5({ rotateIdleAtPole })` | `recorded-mount.test.ts`: `failed` `rejected` at once (an Idle answer showing the switch Off is a refusal), nothing stopped, mount not held. On the night, before that rule, it ended `uncertain` `no-acknowledgement` after 5 s and held the mount |
| Another client (PHD2) looping 2 s exposures on the guide camera: frames Cria did not ask for | recorded, ZWO ASI220MM Mini, 2026-10-27 (1,027 frames) | `guideLoop` | `recorded-guide-loop.test.ts`: Cria's own frame is the only image, nothing held. The other client's own write (an inbound `newNumberVector`) is not reproduced; Cria ignores it |
| A focuser move that ends Ok short of the target | **derived** (63 recorded moves all arrived) | `addEaf({ stopsShortBy })` | `derived-non-mount.test.ts`: uncertain `not-confirmed`, focuser not held |
| A focuser that never answers a move | **derived** | a behaviour that ignores `ABS_FOCUS_POSITION` | `derived-non-mount.test.ts`: uncertain `no-acknowledgement`, abort sent, not held |
| A switch write acknowledged Ok and not applied | **derived** (the recorded relative is `pegasusDew`) | `appliesNothing` | `derived-non-mount.test.ts`: uncertain `not-confirmed`, not held |
| A weather device that never answers a connect (weather's only command) | **derived** | a behaviour that ignores `CONNECTION` | `derived-non-mount.test.ts`: uncertain `no-acknowledgement`, not held |

What the recordings do not hold, so no recorded case exists: a camera exposure with no answer, an Alert on an exposure, a camera abort that left the exposure Busy, a connection drop, a driver crash, a focuser that stopped short, a readback that never matched on a camera, focuser, relay or dew write. Of 1,462 exposures, 63 focuser moves and 22 camera aborts, every one was answered within 1.1 s and arrived.

## Serving a case to a test Vela

A person can meet any case in a browser: one command starts a fake errai rig (both cameras, the EAF, the AM5 and the Pegasus box on the fake INDI server) with one failure, and the real Cria on it. Point a test Vela's Cria address at it and send the command the scenario names. Nothing touches errai, the rig or any hardware, and the scenarios are the ones `apps/cria/test/scenarios.test.ts` runs, so what the list promises is tested.

```sh
cd ts
pnpm install                              # once
pnpm fake-rig list                        # every scenario, what to do in Vela, what you should see
pnpm fake-rig serve camera-silent         # Cria on http://127.0.0.1:4320
pnpm fake-rig serve focuser-short --host 0.0.0.0 --port 4320   # reachable from another machine; use only on a network you trust
CRIA_TOKEN=secret pnpm fake-rig serve mount-power-cut           # Cria asks for this bearer token
```

`serve` prints the scenario, what to try and what to expect, then `listening on http://HOST:PORT`, and runs until you stop it (Ctrl-C). `--acknowledge-ms N` shortens the 5 s a command waits for the driver's answer (the default is errai's). The failure stays: every matching command meets it again, and a restart gives the devices a fresh state and clears a held mount. This Cria speaks wire protocol 5, so the Vela must be one that does (the one that shows the uncertain warning, vela#208).

| Scenario | Source | Do in Vela | Vela shows |
| --- | --- | --- | --- |
| `camera-silent` | derived | start a capture on the primary camera | `uncertain` (no acknowledgement) on the camera: the warning; camera not held |
| `focuser-short` | derived | move the focuser to 31000 | `uncertain` (stopped at 31150, short of 31000): the warning; focuser not held |
| `focuser-silent` | derived | move the focuser to 31000 | `uncertain` (no acknowledgement): the warning; focuser not held |
| `switch-ignored` | derived | switch channel 0 (12 V ports) off | after 15 s `uncertain` (driver still shows the old value): the warning; switch not held |
| `weather-silent` | derived | connect the weather device | after 8 s `uncertain` (no acknowledgement): the warning; not held |
| `guide-loop` | recorded | capture on the primary camera while watching the guide camera | the guide camera gets a frame every 2.75 s unasked; the capture confirms; no warning |
| `mount-home-stop` | recorded | send the mount Home, stop it a second later | `stopped` once the mount is still; not held |
| `mount-power-cut` | recorded | rotate the mount; power is cut a second after it starts | `uncertain` (stop not confirmed) after repeated stops; **mount held** until Clear hold |
| `mount-pole-rotate` | recorded | rotate the mount (it starts at Home) | `failed` (rejected: the driver answered Idle and did not start) at once; not held |

A camera, focuser, weather or switch device ends `uncertain` and is not held (cria#34); only the mount holds. The first five scenarios are the ones that show the non-mount warning, and all five are derived, because the recordings hold no real failure of those devices (see "Cases from recorded failures").

## Check the wire with the golden

`pnpm golden` drives a fixed list of scenarios through the typed client against Cria on the fake INDI server. It replaces IDs, times and durations with placeholders and compares the result with `ts/testing/golden/wire.golden.json`. On a mismatch it prints what changed per scenario and step, and exits 1.

`pnpm golden:update` rewrites the golden. Run it only for an intentional wire change that Vela agreed to, and commit the golden with that change. A refactor that needs it has changed behavior.

## Show that a test guards a line

`testing/mutate.mjs` breaks one line, runs the given tests and restores the file. It exits 0 when the tests fail on the broken line. A failing test shows that the test guards that line.

```sh
node testing/mutate.mjs apps/cria/src/wire/sse.ts 'sentRevision = snapshotRevision' 'sentRevision = revision' apps/cria/src/wire/sse.test.ts
```

## What the tests do not prove

The tests never command real equipment, so they do not prove how the rig's drivers behave under a command. The errai replay covers only the drivers' definitions. Vela's own client has not been tested against the TypeScript Cria yet. [The Vela migration checklist](ts/vela-migration.md) adds that test.

## Legacy .NET tests

The .NET service's offline suite (`tools/check.sh` and `tests/*.py`) is described in [legacy-windows.md, "Testing the .NET service"](legacy-windows.md#testing-the-net-service).
