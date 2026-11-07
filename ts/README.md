# Cria (TypeScript)

Cria connects INDI devices, taps its writes into the rig stream and serves `/health` and `/connect`. [SPEC.md](../docs/ts/SPEC.md) is the contract.

## Layout

| Path | What it is |
|---|---|
| `apps/cria` | the service: config, `connect.ts` (device-connect), `stream.ts`, `http.ts`, `rig.ts` |
| `apps/rig-stream` | the rig stream client and viewer |
| `packages/indi` | INDI client, mirror, XML, traffic tap |
| `packages/stream` | rig stream entries, subjects and publisher |
| `packages/cria-wire` | protocol 6 schemas (health, connect); `dist/` is committed |
| `packages/fake-indi` | a small INDI server for tests |
| `deploy` | systemd units, errai's config, the rig supervisor, PHD2 setup |
| `testing` | the golden, the dist check, the lint rules, the supervisor and PHD2 tests |

## Commands

```sh
pnpm install
pnpm build
./verify.sh                                  # build, typecheck, committed dist, tests and golden
pnpm golden:update                           # only for a reviewed wire change
node apps/cria/dist/main.js <config.json>    # run Cria
```

Run `./verify.sh` before every commit under `ts/` and read its own exit code. Commit before it: it compares `packages/cria-wire/dist` with the last commit.
