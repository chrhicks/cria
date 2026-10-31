# Cria

Cria is the rig-side service between the telescope equipment and Vela. It is a TypeScript service built on Effect, and it runs on Linux on errai, the rig PC. Cria connects to `indiserver` as an INDI client, turns INDI properties into readings, runs one bounded operation at a time per failure domain, and serves Vela over HTTP and SSE as wire protocol 5. It has no dashboard. Vela is the interface.

[SPEC.md](docs/ts/SPEC.md) is the contract and the design. [The architecture](docs/architecture.md) says what Cria and Vela each own. [Runtime](docs/runtime.md) covers errai, and [testing](docs/testing.md) covers the checks.

Vela's client still speaks protocol 4, so it cannot drive this Cria until [the Vela migration checklist](docs/ts/vela-migration.md) lands.

## Legacy .NET service on Windows

Until 2026-10-15, Cria was a .NET 10 API with .NET Framework 4.8 ASCOM driver workers and a Windows desktop launcher, and it spoke protocol 4. It stays in the repo but is legacy. Its code and tools are in `src/`, `tests/`, `contract/`, `config/`, `tools/`, `packaging/windows/` and `licenses/third-party/`, with the root `Cria.slnx`, `global.json`, `Directory.Build.props` and `package.json`. [legacy-windows.md](docs/legacy-windows.md) keeps its runtime and test notes.

## Build and verify

You need Node 24 or later, pnpm, and libindi with its simulators for the tests.

```sh
cd ts
pnpm install
pnpm verify
```

`pnpm verify` runs `ts/verify.sh`: build, typecheck, the committed `dist/` check, and `pnpm test` (every test, then the wire golden). It exits with the failing stage's exit code. Run `./verify.sh` from `ts/` directly to read that code yourself. `pnpm test` includes the golden; `pnpm golden` checks the wire alone against `ts/testing/golden/wire.golden.json`. No test touches hardware. [Testing](docs/testing.md) and [ts/README.md](ts/README.md) say what each check proves.

## Layout

| Path | Contents |
| --- | --- |
| `ts/` | The TypeScript Cria: the shared packages, the service, its tests and tools. See [ts/README.md](ts/README.md) |
| `ts/deploy/` | The systemd user units for `indiserver`, Cria and the rig supervisor, and errai's configuration |
| `docs/` | [Architecture](docs/architecture.md), [runtime](docs/runtime.md), [testing](docs/testing.md) and the [legacy Windows notes](docs/legacy-windows.md) |
| `docs/ts/` | [SPEC.md](docs/ts/SPEC.md) and [the Vela migration checklist](docs/ts/vela-migration.md) |
| `src/` | Legacy. The .NET API, driver contracts, worker logic, Windows worker and desktop launcher |
| `tests/` | Legacy. The .NET fixture and its API, failure and Vela checks |
| `contract/` | Legacy. The protocol 4 OpenAPI schema and its generator |
| `config/` | Legacy. The Windows configuration example |
| `tools/` | Legacy. The .NET check and Windows packaging scripts |
| `packaging/windows/` | Legacy. Windows startup and installation entry points |
| `licenses/third-party/` | Legacy. Dependency notices and source checksums for the Windows package |

Research under `docs/planning/` stays local and ignored, as do `archive/` and generated outputs.

## Ownership of the rig

Who owns the equipment is a live condition, not a fact this README can establish. Verify the current owner before you start Cria or connect it to the rig. Agents do not command the real rig unless Chris is present, as [AGENTS.md](AGENTS.md) says.
