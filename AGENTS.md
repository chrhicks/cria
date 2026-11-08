# Cria

Cria is TypeScript on errai, the PC connected to the rig, and on thuban. The rig program (`ts/src/bin/rig.ts`, the `rig` unit) keeps the rig's devices connected and set up as one file says, restarts a driver that is missing or whose link is dead, and records the INDI wire, the journal and PHD2 to the rig stream (NATS JetStream on thuban) over the same INDI connection; the viewer reads it. [README.md](README.md) says what runs where.

## Rules

- **Desired state, not commands.** The rig file (`~/.config/cria/rig.json` on errai) says what each device should be. Each poll the rig program writes only what differs from what INDI shows; there are no operations to track and nothing is replayed. None of the properties it writes starts a motion or an exposure; keep it that way.
- **Exit and let systemd restart, don't reconnect.** When the INDI connection (or the viewer's broker connection) is lost, or anything unexpected throws, the program exits non-zero and systemd starts it again with fresh state. No reconnect loops, retry wrappers or catch-and-continue around a lost connection; the one exception is the broker connection of the rig program, which the NATS client reconnects itself so bring-up never waits for thuban.
- **A restart waits for Busy.** A driver is restarted only when no property of any device it serves is Busy (a dead serial link excepted for that device's own properties) and hardware is present; the FIFO restart and its backoff are the only way a driver is touched.
- **Keep heavy work off the rig PC.** errai is a mini PC (Intel N150, 16 GB) dedicated to the rig.
- **Verify rig ownership before running against the rig.** Builds and test runs do not authorize rig changes.
- **Do not command the real rig without Chris present.** Reads and simulators are fine. Anything that moves, exposes or changes a setting, needs Chris in the session.
- **Site values stay out of the repo and the logs.** Coordinates live in the rig file on errai only; the rig program logs property and element names, never the values it writes.
- **No comments in new code.** A limit or default is config with a description and a default; a surprise becomes a better name or type; a reason that fits neither goes in the PR.
- **Run `ts/verify.sh` and check its own exit code.** Run `cd ts && ./verify.sh` before every commit that touches `ts/`. Never read the exit code from the end of a pipe: a pipe once reported a failing suite as passing.

## Repository

`ts/` holds the code, `ts/deploy/` the systemd units, and [README.md](README.md) the layout, the tests and how to deploy. [docs/phd2.md](docs/phd2.md) covers PHD2. `archive/`, `docs/planning/` and generated artifacts are local and ignored; do not add them to Git.
