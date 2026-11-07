# Cria on Linux (TypeScript)

Cria rewritten as an INDI client: it connects to `indiserver`, turns INDI
properties into Readings, runs bounded operations as Runs, and serves Vela over
wire protocol 5 (`@cria/wire`). The design,
the primitive map and what building it changed are in
[docs/ts/SPEC.md](../docs/ts/SPEC.md).

## Layout

| Path | What | Primitive layer |
| --- | --- | --- |
| `packages/primitives` | Outcome, Reading, writeOnce, confirm, stoppable, Run | Types and disciplines; depends only on `effect`, built to move to Vela |
| `packages/indi` | XML framing, property mirror, `IndiClient` / `IndiDevice` | INDI boundary (no primitive) |
| `packages/indi-replay` | `indi-replay`: serves a recording over TCP like indiserver, for running the real Cria against a recorded night; `synthesizeTape` | — |
| `packages/recording` | `@cria/recording`: the recording format, the recorder behind the INDI client's tap, the reader and `verifyRecording` | Recording (off unless `record` is configured) |
| `packages/stream` | `@cria/stream`: what anything adding to the rig stream shares: the entry format |
| `packages/recording-archive` | `cria-archive`: copies a finished recording from errai to thuban, keeps the frames Vela saved and the autofocus samples, packs it as tar + zstd, checks the pack replays, then deletes errai's copy with `--apply` (docs/runtime.md, "Archiving recordings to thuban") | — |
| `packages/cria-wire` | `@cria/wire`: the protocol 5 schemas and the 15-kind command table, shared with Vela | View |
| `apps/cria/src/capability` | camera, mount, focuser, box, connection | Capabilities |
| `apps/cria/src/operation` | workflow bodies; the ledger, one owner of operations per rig with one Run per device | Workflows, Run |
| `packages/fits` | `@cria/fits`: FITS header, FITS → ImageBytes, test frames | Image boundary |
| `packages/fake-indi` | `@cria/fake-indi`: a small INDI server written from the protocol, independent of `@cria/indi`'s parser; `fixtures/am5/` and `playMotion` replay AM5 motions cut from errai's recordings (docs/testing.md, "AM5 motion fixtures") | — |
| `apps/cria/src/image` | the rolling image store | Image boundary |
| `apps/cria/src/wire` | projection into protocol 5, HTTP, SSE | View and wire boundary |
| `apps/cria/src/rig.ts`, `device.ts`, `ids.ts`, `service.ts`, `main.ts`, `config.ts` | composition | — |
| `apps/cria/src/refusal.ts` | `Refusal`: a closed error code the HTTP layer maps to a status | Wire boundary |
| `apps/cria/test` | scenario tests; `drivers.ts` models the rig's INDI drivers on `@cria/fake-indi` | — |
| `testing/indiserver.ts` | runs a real indiserver with simulators for tests | — |
| `testing/cria-client.ts` | a typed protocol 5 client for tests; decodes every response strictly | — |
| `testing/replay.test.ts` | the real Cria against `indi-replay` on a recording the simulators made: digests, hour angle, abort, the end, liveness | — |
| `testing/recorder-crash.test.ts` | `kill -9` of a real process at each step of the recorder's write order | — |
| `testing/measure-recording-stall.ts` | not a test: what recording costs the event loop, healthy and on a stalled disk | — |
| `testing/rig-supervisor.test.ts` | the rig supervisor against a fake Cria, a temp FIFO and a fake clock | — |
| `testing/lint.test.ts` | source rules: catches, `try`, `.catch(`, `Date.now()` and timers only at reasoned sites; `verify.sh` strict | — |
| `testing/source-hook.mjs` | lets `node` run `main.ts` from source, for the shutdown test | — |
| `testing/mutate.mjs` | breaks one line, runs the given tests, restores it: shows a test guards that line | — |
| `testing/golden/` | the wire golden: scenarios, normalizer and the committed `wire.golden.json` | — |
| `verify.sh` | every check, in order (`pnpm verify`) | — |
| `deploy/` | errai's config, the systemd user units and the rig supervisor (install steps in `docs/runtime.md`) | — |

## Commands

Node 24 or later, pnpm, and for the tests libindi with its simulators
(`indiserver`, `indi_simulator_ccd`, `_telescope`, `_focus`, `_weather`).

```sh
cd ts
pnpm install
pnpm verify      # build, typecheck, committed dist/, pnpm test: about 2 min
pnpm test        # every test, then the wire golden, about 90 s; starts its own indiservers on free ports
pnpm build       # primitives, indi, then the service, into dist/
pnpm archive SESSION...        # archive a finished recording (dry run unless --apply)
pnpm replay serve <recording>   # indi-replay from source: a recording served like indiserver (docs/ts/SPEC.md, "Replay")
pnpm fake-rig list              # recorded and derived failure cases on a fake rig; `serve <case>` runs the real Cria on one (docs/testing.md)
node apps/cria/dist/main.js deploy/rig.errai.json
```

Cria speaks wire protocol 5; Vela's current client (protocol 4) does not work with
it until Vela adopts `@cria/wire`. The tests use their own typed client
(`testing/cria-client.ts`). None of the tests touch hardware.

## Verification

`pnpm verify` runs `verify.sh`: build, typecheck, a check that the committed
`dist/` of the shared packages matches a fresh build, then `pnpm test` (the
full suite, then the wire golden). Build runs first because `apps/cria` typechecks against the
`dist/` of `@cria/indi`, which git does not hold, so `pnpm verify` passes on a
fresh clone. It prints pass or FAIL per stage and exits with the failing stage's
code. Run it before every commit that touches `ts/`.

The suite asserts literal values. The primitives run on Effect's TestClock, the
event stream on faked interval timers, and every scenario waits for a state with
a deadline that names what it waited for. To show a test guards a line:

```sh
node testing/mutate.mjs apps/cria/src/wire/sse.ts 'sentRevision = snapshotRevision' 'sentRevision = revision' apps/cria/src/wire/sse.test.ts
```

It exits 0 when the tests went red (the mutant was killed) and always restores
the file.

`pnpm golden` (about 15 s; `pnpm test` runs it after the unit suite) drives a fixed list of scenarios through the typed
client against Cria on the fake INDI server: every operation kind, the
admission and lookup refusals, cancel, stop pre-emption, an unacknowledged
command, image download. It records each response, replaces IDs, times
and durations with placeholders, and compares the result with
`testing/golden/wire.golden.json`. On a mismatch it prints what changed per
scenario and step and exits 1:

```text
scenario "mount-slew", step 1 (POST /v2/operations):
  body.parameters.coordinateSystem: missing (golden has "topocentric")
  body.parameters.system: unexpected "topocentric"
```

`pnpm golden:update` rewrites the golden. Run it only for a reviewed,
intentional change to the wire (a protocol change Vela agreed to), and commit
the golden with that change so the diff shows exactly what Vela will see. A
refactor that needs it has changed behaviour.
