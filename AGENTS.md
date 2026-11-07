# Cria

Cria is a small TypeScript service on errai, the PC connected to the rig. It connects to `indiserver` as an INDI client, publishes every `new*Vector` it sends to the rig stream (NATS JetStream on thuban), and connects or disconnects one configured device when asked over HTTP. Clients read the rig from the stream. [README.md](README.md) says what runs where.

## Rules

- **Cria starts nothing on its own.** It connects or sets up a device only when `POST /connect` asks. The one thing that asks on the rig is the outside `rig-supervisor` (`ts/src/rig`), which also restarts a driver whose device is missing while its hardware is present and no property of that driver's devices is Busy. Anything else about a driver is a person's decision.
- **Never blindly replay an unknown outcome.** If Cria cannot tell whether a write took effect, the answer is `uncertain` and nothing is resent.
- **Keep heavy work off the rig PC.** errai is a mini PC (Intel N150, 16 GB) dedicated to the rig.
- **Runs are ephemeral.** A restart is a new `instanceId`; nothing is kept.
- **Verify rig ownership before connecting.** Confirm the current owner before Cria connects to errai's `indiserver`. Builds and test runs do not authorize rig changes.
- **Do not command the real rig without Chris present.** Reads and simulators are fine. Connecting a device, or anything that moves, exposes or changes a setting, needs Chris in the session.
- **No comments in new code.** A limit or default is config with a description and a default; a surprise becomes a better name or type; a reason that fits neither goes in the PR.
- **Run `ts/verify.sh` and check its own exit code.** Run `cd ts && ./verify.sh` before every commit that touches `ts/`. Never read the exit code from the end of a pipe: a pipe once reported a failing suite as passing.

## Repository

`ts/` holds the code, `ts/deploy/` the systemd units, and [README.md](README.md) the layout, the tests and how to deploy. [docs/phd2.md](docs/phd2.md) covers PHD2. `archive/`, `docs/planning/` and generated artifacts are local and ignored; do not add them to Git.
