# Cria

Cria is a small TypeScript service (Effect, Node 24) on errai, the rig PC. It connects to `indiserver` as an INDI client, publishes every write it sends to the rig stream (NATS JetStream), and serves `GET /health` and `POST /connect` over HTTP to connect or disconnect one configured device and set it up. It has no dashboard.

[SPEC.md](docs/ts/SPEC.md) is the contract. [The architecture](docs/architecture.md) says what each part owns. [Runtime](docs/runtime.md) covers errai, and [testing](docs/testing.md) covers the checks.

## Build and verify

You need Node 24 or later, pnpm, and libindi with its simulators (the supervisor test uses one).

```sh
cd ts
pnpm install
./verify.sh
```

`verify.sh` runs build, typecheck, the committed `dist/` check, and `pnpm test` (every test, then the wire golden), and exits with the failing stage's exit code. No test touches hardware.

## Layout

| Path | Contents |
| --- | --- |
| `ts/` | The code: the service, the shared packages, the tests. See [ts/README.md](ts/README.md) |
| `ts/deploy/` | The systemd user units, errai's configuration and the rig supervisor |
| `docs/` | [Architecture](docs/architecture.md), [runtime](docs/runtime.md), [testing](docs/testing.md) and [SPEC.md](docs/ts/SPEC.md) |

## Ownership of the rig

Who owns the equipment is a live condition. Verify the current owner before you connect Cria to the rig. Agents do not command the real rig unless Chris is present, as [AGENTS.md](AGENTS.md) says.
