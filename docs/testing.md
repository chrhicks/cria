# Testing

Every test runs without hardware. A test talks to a fake INDI server, or to an `indiserver` with a simulator driver that it starts on a free port. No test connects to errai or to any device.

You need Node 24 or later, pnpm, and libindi with `indiserver` and `indi_simulator_focus`.

## Run every check

```sh
cd ts
pnpm install
./verify.sh
```

`verify.sh` runs four stages in order: build, typecheck, the committed `dist/` check, and `pnpm test` (the full suite, then the wire golden). It prints `pass` or `FAIL` per stage and exits with the failing stage's exit code. Commit first: the `dist/` check compares with the last commit.

Read the exit code of `./verify.sh` itself. Do not pipe it into `tee` or `tail`: a pipe returns the exit code of its last command.

## What each layer proves

| Layer | Files under `ts/` | What it proves |
| --- | --- | --- |
| INDI boundary | `packages/indi/src/*.test.ts` | XML framing from recorded traffic split at random byte boundaries, BLOB decoding, `delProperty`, bad input, and one client test against a real `indiserver` |
| Stream | `packages/stream/src/*.test.ts` | Entry format, subjects, the publisher |
| Wire schemas | `packages/cria-wire/src/*.test.ts` | Health and connect schemas on literal inputs |
| Fake INDI server | `packages/fake-indi/src/*.test.ts` | The fake delivers what a real `indiserver` delivers (below) |
| Cria | `apps/cria/test/*.test.ts` | device-connect (connect, disconnect, port, each setup step, skipped and unanswered properties, Alert), `/health` and `/connect` over HTTP, the stream entries, config |
| Rig stream | `apps/rig-stream/src/*.test.ts` | Journal, PHD2 and viewer history handling |
| Golden | `testing/golden` | The HTTP wire, replayed on the fake INDI server and compared with `wire.golden.json` |
| Supervisor and PHD2 | `testing/rig-supervisor.test.ts`, `testing/phd2-*.test.ts` | The supervisor's rules against a fake Cria and a real `indiserver`, and the PHD2 setup scripts |
| Source rules | `testing/lint.test.ts` | Catches, `try`, `.catch(`, `Date.now()` and timers appear only at counted, reasoned sites, and `verify.sh` stays strict and pipe-free |
| Shipped package | `testing/dist.test.ts` | The committed `dist/` of `@cria/wire` matches a fresh build |

Scenario tests wait for a state with a deadline that names what they waited for, never for a fixed time. Cria sets nothing up by itself, so a test that needs a ready device sends `POST /connect` first.

## The golden

`pnpm golden` (which `pnpm test` also runs) drives the scenarios in `testing/golden/scenarios.ts` through the typed client against Cria on the fake INDI server, replaces ids, times and the converted longitude with placeholders, and compares with `testing/golden/wire.golden.json`. A mismatch prints what changed and exits 1. `pnpm golden:update` rewrites it, only for an intended wire change; commit the golden with that change.

## Keep the fake the same as indiserver

`packages/fake-indi` stands in for `indiserver`, so what it delivers is measured against the real one. Python scripts under `packages/fake-indi/measure/` start a real `indiserver` (libindi 2.2.5) with the INDI simulators or a scripted driver, connect clients, and write what each client received into a JSON file under `src/`. The tests replay the same steps against the fake and compare. The files are committed, so CI needs no libindi; re-run a script after a libindi upgrade or when a new case needs measuring (each script's header says how).

## What the tests do not prove

The tests never command real equipment, so they do not prove how the rig's drivers behave under a command.
