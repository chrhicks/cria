# Cria on Linux (TypeScript)

Cria rewritten as an INDI client: it connects to `indiserver`, turns INDI
properties into Readings, runs bounded operations as Runs, and serves Vela over
wire protocol 5 (`@cria/wire`). The design,
the primitive map and what building it changed are in
[docs/ts/SPEC.md](../docs/ts/SPEC.md). The .NET tree beside this folder is
legacy ([docs/legacy-windows.md](../docs/legacy-windows.md)).

## Layout

| Path | What | Primitive layer |
| --- | --- | --- |
| `packages/primitives` | Outcome, Reading, writeOnce, confirm, stoppable, retryReads, Run, `quarantineOf` | Types and disciplines; depends only on `effect`, built to move to Vela |
| `packages/indi` | XML framing, property mirror, `IndiClient` / `IndiDevice` | INDI boundary (no primitive) |
| `packages/cria-wire` | `@cria/wire`: the protocol 5 schemas and the 15-kind command table, shared with Vela | View |
| `apps/cria/src/capability` | camera, mount, focuser, weather, power, connection | Capabilities |
| `apps/cria/src/operation` | workflow bodies; the ledger, one owner of operations per rig with one Run per failure domain | Workflows, Run, Quarantine |
| `apps/cria/src/image` | FITS → ImageBytes, rolling store | Image boundary |
| `apps/cria/src/wire` | projection into protocol 5, HTTP, SSE | View and wire boundary |
| `apps/cria/src/rig.ts`, `device.ts`, `ids.ts`, `service.ts`, `main.ts`, `config.ts` | composition | — |
| `apps/cria/src/refusal.ts` | `Refusal`: a closed error code the HTTP layer maps to a status | Wire boundary |
| `apps/cria/test` | scenario tests, fake INDI server | — |
| `testing/indiserver.ts` | runs a real indiserver with simulators for tests | — |
| `testing/cria-client.ts` | a typed protocol 5 client for tests; decodes every response strictly | — |
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
pnpm verify      # build, typecheck, committed dist/, wire golden, every test: about 2 min
pnpm test        # every test, about 75 s; starts its own indiservers on free ports
pnpm build       # primitives, indi, then the service, into dist/
node apps/cria/dist/main.js deploy/rig.errai.json
```

Cria speaks wire protocol 5; Vela's current client (protocol 4) does not work with
it until Vela adopts `@cria/wire`. The tests use their own typed client
(`testing/cria-client.ts`). None of the tests touch hardware.

## Verification

`pnpm verify` runs `verify.sh`: build, typecheck, a check that the committed
`dist/` of the shared packages matches a fresh build, the wire golden, then the
full suite. Build runs first because `apps/cria` typechecks against the
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

`pnpm golden` (about 15 s) drives a fixed list of scenarios through the typed
client against Cria on the fake INDI server: every operation kind, the
admission and lookup refusals, cancel, stop pre-emption, an unacknowledged
command and its recovery, image download. It records each response, replaces IDs, times
and durations with placeholders, and compares the result with
`testing/golden/wire.golden.json`. On a mismatch it prints what changed per
scenario and step and exits 1:

```text
scenario "mount-slew", step 1 (POST /v2/operations):
  body.failureDomain: missing (golden has "zwo-am5")
  body.domain: unexpected "zwo-am5"
```

`pnpm golden:update` rewrites the golden. Run it only for a reviewed,
intentional change to the wire (a protocol change Vela agreed to), and commit
the golden with that change so the diff shows exactly what Vela will see. A
refactor that needs it has changed behaviour.

## Before trying it on the rig

Device and property names were checked against errai on 2026-10-15 (see "Checked
on errai" in [docs/ts/SPEC.md](../docs/ts/SPEC.md)); `deploy/rig.errai.json` has
the real names and sends nothing at start (`connect: false`). Still needed:

1. Decisions on the gaps found there, at least: the 2600's `UPLOAD_MODE` is local
   (Cria refuses its captures until it is client), and the AM5's clock reads 2000
   (gotos would point wrong).
2. Vela on protocol 5 ([docs/ts/vela-migration.md](../docs/ts/vela-migration.md)), and Vela's
   `cria.json`: each `expectedName` becomes the INDI device name.
3. `listen.host` in the config: errai's tailnet address.
4. The full review of the command paths (in progress).
5. First session with Chris present: readings only, then one short dark capture,
   a small focuser move, tracking on/off, and a cancelled slew. Check by eye that
   a positive axis rate moves the mount east (increasing RA); Cria assumes it.
