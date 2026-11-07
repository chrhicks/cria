# Cria

Cria is a small TypeScript service on errai, the PC connected to the rig. It connects to `indiserver` as an INDI client, publishes every `new*Vector` it sends to the rig stream (NATS JetStream on thuban), and connects or disconnects one configured device when asked over HTTP. Clients read the rig from the stream. [docs/ts/SPEC.md](docs/ts/SPEC.md) is the contract and [docs/architecture.md](docs/architecture.md) says who owns what.

## Rules

- **Cria starts nothing on its own.** It connects or sets up a device only when `POST /connect` asks. The one thing that asks on the rig is the outside `rig-supervisor` (`ts/deploy/rig-supervisor.mjs`), which also restarts a driver whose device is missing while its hardware is present and no property of that driver's devices is Busy. Anything else about a driver is a person's decision. See [docs/runtime.md](docs/runtime.md#the-rig-supervisor).
- **Never blindly replay an unknown outcome.** If Cria cannot tell whether a write took effect, the answer is `uncertain` and nothing is resent.
- **Keep heavy work off the rig PC.** errai is a mini PC (Intel N150, 16 GB) dedicated to the rig.
- **Runs are ephemeral.** A restart is a new `instanceId`; nothing is kept.
- **Verify rig ownership before connecting.** Confirm the current owner before Cria connects to errai's `indiserver`. Builds and test runs do not authorize rig changes.
- **Do not command the real rig without Chris present.** Reads and simulators are fine. Connecting a device, or anything that moves, exposes or changes a setting, needs Chris in the session.
- **Run `ts/verify.sh` and check its own exit code.** Run `cd ts && ./verify.sh` before every commit that touches `ts/`, after committing (it compares `packages/cria-wire/dist` with the last commit). Never read the exit code from the end of a pipe: a pipe once reported a failing suite as passing.

## Repository

`ts/` holds the code and [ts/README.md](ts/README.md) its layout and commands. `ts/deploy/` holds the systemd units and errai's configuration. See [README.md](README.md), [docs/runtime.md](docs/runtime.md) and [docs/testing.md](docs/testing.md). `archive/`, `docs/planning/` and generated artifacts are local and ignored; do not add them to Git.
