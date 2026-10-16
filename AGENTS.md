# Cria

Cria is a rig-side service for astronomy equipment. It is a TypeScript service on Linux and runs on errai, the PC connected to the rig. It talks to the equipment through INDI. `indiserver` runs one process per driver, and Cria connects to it as a client. Cria keeps the devices' current state and runs bounded operations close to the drivers. The boundary is drivers → `indiserver` → Cria → clients. Vela is the primary client. Cria is an API service with no dashboard.

Cria is one of two ways Vela talks to a rig; the other is Alpaca directly. Each rig uses exactly one. Vela's AGENTS.md is the product authority. [docs/ts/SPEC.md](docs/ts/SPEC.md) is the Vela–Cria contract, and [docs/architecture.md](docs/architecture.md) explains who owns what.

The .NET Cria on Windows is legacy. Its own rules are under "Legacy .NET service" below.

## Rules

- **Keep heavy work off the rig PC.** Image processing, analysis and previews belong in Vela. errai is a mini PC (Intel N150, 16 GB RAM) dedicated to the rig, so using a few GiB sensibly is fine. Judge memory by sustained growth and headroom, not a fixed budget.
- **Contain driver crashes.** INDI runs one process per driver, so a driver crash does not take Cria down. When a driver dies, `indiserver` deletes its properties, Cria reports the device unavailable, and an operation in flight ends uncertain. Run `indiserver -r 0` so indiserver does not restart a crashed driver by itself. Cria never restarts a driver or connects a device on its own. The one exception (Chris, 2026-10-16) is the outside `rig-supervisor` (`ts/deploy/rig-supervisor.mjs`), so errai can boot before the rest of the rig is powered: it restarts a driver only when a device is missing from INDI, its hardware is present, and nothing is open or held on any device that driver serves, and it sends `device-connect` only to a defined, disconnected device with its hardware present and nothing open or held. It never touches power, motion or exposures, and does nothing while Cria is unreachable or has commands disabled. Anything else about a driver is still a person's decision. See [docs/runtime.md](docs/runtime.md#the-rig-supervisor) and "Restarts and crashes" in [docs/ts/SPEC.md](docs/ts/SPEC.md#restarts-and-crashes).
- **Never blindly replay an unknown outcome.** If Cria cannot tell whether a command took effect, it reports the operation as uncertain and blocks the device until a person checks the equipment and recovers it. Do not resend the command; stop and tell Chris.
  - The one exception (Chris, 2026-10-15): a **stop or abort** may be resent, paced and within its deadline, until the device confirms it is stationary. An abort can only stop motion, never start it. A motion, exposure or setting command is never resent.
- **Runs are ephemeral.** A Cria restart means a new `instanceId` and an empty operation table, so any operation in flight before it is unknown. There is no journal and no custody obligation to Vela.
- **Images are a rolling set the service may drop; there is no custody.** Do not add durable operation or image history back.
- **Verify rig ownership before connecting.** Do not infer the current owner from an old document or trial. Confirm the current owner before Cria connects to errai's `indiserver`. Builds and test runs do not authorize rig changes.
- **Do not command the real rig without Chris present.** Reads and simulators are fine: reading state, a read-only Cria (`commandsEnabled: false` and `connect: false` on every device), the fake INDI server and the INDI simulators. Anything that moves the mount or focuser, exposes a camera, changes a setting, switches power or connects a device needs Chris in the session.
- **Run `ts/verify.sh` and check its own exit code.** Run `cd ts && ./verify.sh` before every commit that touches `ts/`, and read the exit code of `verify.sh` itself. Never read it from the end of a pipe. A pipe once reported a failing suite as passing.

## Repository

`ts/` holds the TypeScript Cria, and [ts/README.md](ts/README.md) has its layout and commands. `ts/deploy/` holds the systemd units and errai's configuration. See `README.md`, `docs/runtime.md` and `docs/testing.md`. `verify.sh` and the tests deploy nothing and touch no equipment. `archive/`, `docs/planning/` and generated artifacts are local and ignored; do not add them to Git.

## Legacy .NET service

The .NET Cria on Windows (`src/`, `tests/`, `tools/`, `packaging/windows/`) stays in the repo but is no longer the norm. [docs/legacy-windows.md](docs/legacy-windows.md) holds its runtime and test notes. These rules apply only when working on it:

- Vendor DLLs (cameras, EAF) run in isolated .NET Framework 4.8 workers that talk to the .NET 10 API over StreamJsonRpc. If a worker fails, the API stays up and reports the last values as stale or unavailable. Isolation does not prove the equipment stopped, so never restart or kill a worker automatically.
- ASCOM Remote and the legacy Alpaca reader must not be reconnected without a confirmed release from the current owner.
- Run the offline suite with `CRIA_DOTNET=/path/to/dotnet VELA_ROOT=/path/to/vela ./tools/check.sh`; `./tools/publish.sh` builds the Windows package. Neither deploys anything or touches equipment.

## Shared Coding and review

Shared Coding owns how work is done. Load it through Executor with `skills({app:"shared-coding",name:"shared-coding"})` before coding or reviewing. If Executor is unavailable, say so and continue with this file.

Review is light by default; full review only for code that sends commands to equipment (the driver workers and operation execution).

## Communication

Use plain English: familiar words, concrete examples, and sentences that explain one idea at a time. Optimize for understanding, not the fewest tokens.

- Answer the original question directly, then explain enough of the reasoning for the user to understand what the result means for their request.
- Keep the important connecting details: what each component does, where work happens, and how data changes as it moves between components.
- Introduce necessary jargon with a brief explanation. When similar terms mean different things, make the distinction explicit.
- Separate what was observed from what is inferred or still unknown.
- Be concise by removing repetition and filler, not by omitting steps the user needs to follow the explanation.

## Long term memory

Use `continuum` through `executor` for long term memory. Store decisions, learnings and troubleshooting advice so you never make the same mistake twice.

## Threads

In T3 Code, use Threads for discussions with other agents across projects, or for distinct longer-term tasks in this project. Threads keep their own context and can run their own subagents.
