# Running Cria on errai

Cria runs on errai, the rig's mini PC (Intel N150) on Arch Linux. Two programs run there:

- `indiserver` owns the drivers. It runs each INDI driver as its own process: `indi_asi_ccd` (both ZWO cameras), `indi_asi_focuser` (the EAF), `indi_lx200am5` (the AM5) and `indi_pegasus_ppba` (the Pegasus power box). It listens on TCP 7624.
- Cria is a Node process. It connects to `indiserver` at `127.0.0.1:7624` as an INDI client and serves Vela over HTTP and SSE on port 4319.

[The architecture](architecture.md) says what each part owns. [SPEC.md](ts/SPEC.md) is the full contract. The .NET service on Windows is legacy. Its runtime notes are in [legacy-windows.md](legacy-windows.md).

## The production layout in `ts/deploy`

`ts/deploy` holds the layout Cria is meant to run in. Both unit files say "Example only: not installed anywhere."

- `indiserver.service` runs `indiserver -r 0 -p 7624 indi_asi_ccd indi_asi_focuser indi_lx200am5 indi_pegasus_ppba` as `chicks`, with `Restart=no`. `-r 0` stops indiserver from restarting a crashed driver. A person decides when a driver comes back.
- `cria.service` starts after `indiserver.service` and runs `/usr/bin/node /opt/cria/apps/cria/dist/main.js /etc/cria/rig.json` as `chicks`. It has `Restart=on-failure` and `TimeoutStopSec=180`.
- `rig.errai.json` is errai's configuration: the six devices with their real INDI names, `connect: false` on each, `commandsEnabled: true`, and images in `/var/lib/cria/images`.

## The interim deploy on errai

This section records the deploy as it was set up on 2026-10-15. The repo does not track it, so check errai for its current state. The deploy notes live on errai in `~/dev/personal/cria-deploy-notes/`.

- Cria runs from the worktree `~/dev/personal/cria-ts`, not from `/opt/cria`.
- The unit is a user unit, `~/.config/systemd/user/cria.service`. It has no `[Install]` section, so it does not start at boot.
- The configuration is `~/.config/cria/rig.json`. It has `commandsEnabled: false` and `connect: false` on every device, and listens on `127.0.0.1:4319`. Cria reads every device and refuses every operation with `403 commands-disabled`.

The repo does not record how `indiserver` is started on errai.

To check, stop, start and read the logs of the interim unit:

```sh
systemctl --user status cria.service
systemctl --user stop cria.service
systemctl --user start cria.service
journalctl --user -u cria.service
```

## Configure Cria

Cria takes one argument, the path to its JSON configuration (`node apps/cria/dist/main.js <config.json>`). `CRIA_CONFIG` is read when the argument is missing. An unknown key or an invalid value stops the process at start. [SPEC.md, "Configuration"](ts/SPEC.md#configuration) lists every key and its default.

Two settings decide whether Cria can change the rig:

- `commandsEnabled: false` makes the deploy read-only. Every operation is refused with `403 commands-disabled`, and every device's `availability` reads `commands-disabled`. That reason takes precedence over the others, so in a read-only deploy the readings show whether a device is stale or disconnected, and `availability` does not.
- `connect` is per device. With `connect: true`, Cria sends `CONNECT` once at start to a disconnected device, after writing its serial `port`, as a `device-connect` operation. With `connect: false` or no `connect`, Cria sends nothing at start. Cria never switches power or connects a device on its own.

`listen.host` is `127.0.0.1` in both configurations, so only errai itself can reach Cria. Vela runs on another machine, so `listen.host` has to be errai's tailnet address before Vela can connect. When `CRIA_TOKEN` is set in Cria's environment, every route except `/health` needs `Authorization: Bearer <token>`. Cria refuses any request with an `Origin` header, so a browser cannot call it.

## Stop and restart

`systemctl stop` sends SIGTERM. Cria then interrupts every running operation. Each one aborts its exposure, or stops the mount or the focuser, and confirms the stop before the process exits. `cria.service` allows 180 s for this, because a start-up connect can run for up to `initializeTimeoutMs` (120 s) before the stops start, and each stop then gets up to 20 s. SIGINT does the same.

A restart is a new Cria with nothing carried over:

- It has a new `instanceId`. Anything in flight before the restart is unknown.
- The operation table is empty. No request IDs, bindings, recoveries or quarantines carry over.
- The image folder is emptied.

The INDI drivers keep running and keep their state. A camera that was exposing still reads `exposing`, and a new capture on it settles `failed: busy`.

If a driver crashes, `indiserver` deletes its properties and Cria reports the device unavailable. An operation in flight ends `uncertain: driver-lost` and blocks the device until a person checks the equipment and calls `POST /v2/devices/{id}/recover`. If `indiserver` itself goes away, every device is unavailable and in-flight work ends uncertain. Cria reconnects at a paced interval and resends nothing. [SPEC.md, "Restarts and crashes"](ts/SPEC.md#restarts-and-crashes) has the details.

## Logs

Cria writes to stderr, so journald holds its log under systemd. It logs `cria: instance <id> listening on <port>` at start and `cria: SIGTERM, stopping` at stop. It keeps no telemetry store. Whether it should is [open question 7](ts/SPEC.md#open-questions) in SPEC.md.

## Images

A capture writes its frame to `imageDirectory` as ImageBytes. The folder is a rolling set. Once it passes `imageBudgetBytes` (10 GiB by default), Cria drops the oldest frames, and a request for a dropped frame gets `410 image-gone`. Cria never keeps a frame for Vela. [SPEC.md, "Image path"](ts/SPEC.md#image-path) has the conversion and the store.

## Before Cria commands the rig

The checks on errai so far were read-only. [ts/README.md, "Before trying it on the rig"](../ts/README.md#before-trying-it-on-the-rig) lists what has to happen first, and the first session is with Chris present.
