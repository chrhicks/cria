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
| Wire and image boundaries | `apps/cria/src/wire/sse.test.ts`, `apps/cria/src/image/*.test.ts` | The event stream's cadence, coalescing and subscriber limits, the FITS to ImageBytes conversion, and the rolling image store |
| Fake INDI server | `apps/cria/test/fake-indi.ts` and the scenario tests beside it | Failures a simulator cannot produce: a driver that never acknowledges, a stop that never confirms, a dropped connection, a driver that disappears. Also the HTTP refusals, and SIGTERM during a slew aborting the mount before the process exits |
| INDI simulators | `apps/cria/test/simulators.test.ts`, started by `testing/indiserver.ts` | Capture and download, cancel mid-exposure, focuser moves, slews and tracking against real INDI drivers |
| errai, replayed | `apps/cria/test/errai.test.ts` | Cria running `deploy/rig.errai.json` against the real drivers' recorded definitions (`apps/cria/test/fixtures/errai-2026-10-15.xml`) |
| Source rules | `testing/lint.test.ts` | Catches, `try`, `.catch(`, `Date.now()` and timers appear only at counted, reasoned sites, and `verify.sh` stays strict and pipe-free |
| Shipped packages | `testing/dist.test.ts` | The committed `dist/` of `@cria/primitives` and `@cria/wire` matches a fresh build |

To run the suite without the other stages, run `pnpm test` in `ts/`. It starts its own `indiserver` processes on free ports.

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
