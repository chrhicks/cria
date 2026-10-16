# Running Cria on errai

Cria runs on errai, the rig's mini PC (Intel N150) on Arch Linux. Three programs run there:

- `indiserver` owns the drivers. It runs each INDI driver as its own process: `indi_asi_ccd` (both ZWO cameras), `indi_asi_focuser` (the EAF), `indi_lx200am5` (the AM5) and `indi_pegasus_ppba` (the Pegasus power box). It listens on TCP 7624.
- Cria is a Node process. It connects to `indiserver` at `127.0.0.1:7624` as an INDI client and serves Vela over HTTP and SSE on port 4319.
- The rig supervisor is a small Node script beside them. It brings devices up as they are powered (see "The rig supervisor").

[The architecture](architecture.md) says what each part owns. [SPEC.md](ts/SPEC.md) is the full contract. The .NET service on Windows is legacy. Its runtime notes are in [legacy-windows.md](legacy-windows.md).

## The production layout in `ts/deploy`

`ts/deploy` holds the layout Cria runs in on errai: three systemd **user** units, all `WantedBy=default.target`. errai has linger on, so they start at boot without a login.

- `indiserver.service` runs `indiserver -v -r 0 -p 7624 -f %t/indi.fifo indi_asi_ccd indi_asi_focuser indi_lx200am5 indi_pegasus_ppba`, with `Restart=always` and `RestartSec=3`. `-r 0` stops indiserver from restarting a crashed driver by itself. `-f` makes indiserver read `start <driver>` and `stop <driver>` lines from a FIFO (`$XDG_RUNTIME_DIR/indi.fifo`), so one driver can be restarted without touching the others.
- `cria.service` starts after `indiserver.service` (`Wants=`, not `Requires=`) and runs Cria with `Restart=always` and `TimeoutStopSec=180`. Check its `ExecStart` paths against where Cria is built on errai. Cria does not need indiserver up when it starts: it retries the INDI connection until it succeeds (250 ms, doubling to 5 s), and when indiserver or a driver comes back it sets each device up again ("Device setup" in [SPEC.md](ts/SPEC.md#device-setup)). Restarting `indiserver` therefore does not need a Cria restart. Devices read `unavailable` meanwhile.
- `rig-supervisor.service` starts after `cria.service` with `Restart=always` (see "The rig supervisor" below).
- `rig.errai.json` is errai's configuration: the six devices with their real INDI names, `connect: false` on each, `commandsEnabled: true`, and images in `/var/lib/cria/images`.
- `supervisor.example.json` is the supervisor's configuration.

## Install on errai

Cria's code and config stay where they are; this changes how the three programs start.

```sh
cd <the Cria checkout on errai>
mkdir -p ~/.config/systemd/user ~/.config/cria
cp ts/deploy/*.service ~/.config/systemd/user/
cp ts/deploy/supervisor.example.json ~/.config/cria/supervisor.json   # then edit it, see below
systemctl --user daemon-reload
systemctl --user enable --now indiserver cria rig-supervisor
```

Before the copy, run `systemctl --user cat cria.service` and keep its `ExecStart` if it differs from the repo's: the units are templates, and the interim `cria.service` on errai runs Cria from `~/dev/personal/cria-ts`. Stop a hand-started `indiserver` first (`pkill indiserver`), or the unit cannot bind port 7624. Check with `systemctl --user status indiserver cria rig-supervisor` and `journalctl --user -u rig-supervisor -f`.

In `supervisor.json`, use errai's real serial by-id paths for the mount and the Pegasus (the example has placeholders), and list every device a driver serves under that driver's name (see below).

## Power-up in any order

The mini PC may boot before the rest of the rig has power. Nothing has to be started by hand:

1. `indiserver`, Cria and the supervisor start at boot. Cria serves its API at once; every device reads `unavailable` until its driver defines it.
2. `indi_lx200am5` and `indi_pegasus_ppba` always define their device, but connecting fails until the serial port exists. When the port appears, the supervisor sends `device-connect`; Cria writes the port, connects, and runs device setup (site and time for the AM5).
3. `indi_asi_ccd` and `indi_asi_focuser` define a device only if the USB device is present when the driver starts. When a camera or the EAF is powered later, the supervisor restarts that one driver, then connects the device the same way.

Each step waits for the picture to hold for two polls (about 10 s) so a device that has just enumerated, or Cria's first seconds after it reconnects to indiserver, do not cause a restart.

## The rig supervisor

Cria never restarts a driver and never connects a device on its own. Chris asked on 2026-10-16 for an outside process that does exactly that, narrowly, so the rig comes up unattended. `ts/deploy/rig-supervisor.mjs` is that process (Node built-ins only). It is the one exception to the old rule "never restart a driver automatically". It polls Cria's `GET /v2/state` every 5 s and does two things.

**Restart a driver.** A configured device whose availability reads `unavailable` (indiserver or the driver does not define it), whose hardware is present (a USB `vid:pid` in sysfs, or the serial path), gets its driver restarted, if nothing is open and nothing is held on any device that driver serves, and none of them is exposing, slewing or moving. The supervisor writes `stop <driver>`, waits 1 s, then writes `start <driver>` to the FIFO. Both cameras share `indi_asi_ccd`, so restarting it drops the other camera's INDI session too, which is why the check covers every device of the driver. A device on that driver that was connected is disconnected by the restart, and the supervisor connects it again. Repeats back off at 20 s (never more than one restart per driver per 20 s), then 30 s, then 60 s; the count resets when the driver's devices show up.

**Connect a device.** A defined device whose availability reads `disconnected`, whose hardware is present, with commands enabled and nothing open or held on it, gets one `POST /v2/operations` with `device-connect`, `connected: true` and a fresh `supervisor-<uuid>` request ID. A request is never resent. Further attempts wait 10 s, then 30 s, then 60 s while the device stays disconnected. After a refusal that names a hold (`device-blocked`), `commands-disabled` or an open operation (`device-busy`), it waits quietly until that has cleared.

It does nothing at all while Cria is unreachable (and must see Cria and the hardware agree for two polls after it returns), while commands are disabled, and, for the restart, when every device is unavailable (indiserver is down, not one driver). It never switches power, and never sends motion, exposure or any other command. It logs one line per decision to stdout, so `journalctl --user -u rig-supervisor` shows every action.

**Why these limits.** A restart ends anything in flight on that driver as `uncertain: driver-lost` and holds the device. The checks above make sure nothing Cria knows about is in flight, and a held device is left for a person. An exposure started by another INDI client (PHD2 on the guide camera) shows in the readings as `exposing`, which also blocks a restart.

**What it cannot see.** Cria does not clear its copy of a device's properties when its connection to indiserver drops. If `indiserver` itself restarts while a camera is unpowered, that camera should read `stale`, not `unavailable` (read from the code, not seen on the rig), and the supervisor does not touch it (it only acts on `unavailable`). Restart Cria (`systemctl --user restart cria`) after powering it. This does not happen at boot, when Cria starts with an empty copy.

**Configuration** is `~/.config/cria/supervisor.json` (or the path given as the first argument or in `RIG_SUPERVISOR_CONFIG`):

```json
{
  "criaUrl": "http://127.0.0.1:4319",
  "devices": [
    { "id": "primary", "usb": "03c3:260a", "driver": "indi_asi_ccd" },
    { "id": "mount", "serial": "/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_123456-if00" }
  ]
}
```

`id` is a Cria device ID. Each device has exactly one hardware check, `usb` or `serial`, and a `driver` (the INDI executable name) only if it has `usb`. List every device a driver serves with that driver, because the "nothing open" check covers the listed ones. Optional: `fifo` (default `$XDG_RUNTIME_DIR/indi.fifo`, the path `indiserver.service` uses), `pollMs` (5000), `settlePolls` (2), `stopGapMs` (1000), `requestTimeoutMs` (5000). An unknown key stops it with exit 2. List the Pegasus once, as `weather`: `weather` and `switch` are one INDI device. If Cria has `CRIA_TOKEN` set, give the supervisor the same variable.

**To turn it off:** `systemctl --user disable --now rig-supervisor`. The rig then behaves as before: drivers and connections change only when a person does it.

## The interim deploy on errai

This section records the deploy as it was set up on 2026-10-15, before the units above. The repo does not track errai's state, so check errai for its current state. The deploy notes live on errai in `~/dev/personal/cria-deploy-notes/`.

- Cria runs from the worktree `~/dev/personal/cria-ts`, not from `/opt/cria`.
- The unit was a user unit, `~/.config/systemd/user/cria.service`, without an `[Install]` section, so it did not start at boot.
- The configuration is `~/.config/cria/rig.json`. It had `commandsEnabled: false` and `connect: false` on every device, and listens on `127.0.0.1:4319`. Cria reads every device and refuses every operation with `403 commands-disabled`. The supervisor does nothing against such a Cria.
- `indiserver` was started by hand: `indiserver -v indi_asi_ccd indi_asi_focuser indi_lx200am5 indi_pegasus_ppba`.

To check, stop, start and read the logs of a unit:

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

If a driver crashes, `indiserver` deletes its properties and Cria reports the device unavailable (the supervisor restarts the driver if its conditions hold). An operation in flight ends `uncertain: driver-lost` and blocks the device until a person checks the equipment and calls `POST /v2/devices/{id}/recover`. If `indiserver` itself goes away, every device is unavailable and in-flight work ends uncertain. Cria reconnects at a paced interval and resends nothing. [SPEC.md, "Restarts and crashes"](ts/SPEC.md#restarts-and-crashes) has the details.

## Logs

Cria writes to stderr, so journald holds its log under systemd. It logs `cria: instance <id> listening on <port>` at start and `cria: SIGTERM, stopping` at stop. It keeps no telemetry store. Whether it should is [open question 7](ts/SPEC.md#open-questions) in SPEC.md.

## Images

A capture writes its frame to `imageDirectory` as ImageBytes. The folder is a rolling set. Once it passes `imageBudgetBytes` (10 GiB by default), Cria drops the oldest frames, and a request for a dropped frame gets `410 image-gone`. Cria never keeps a frame for Vela. [SPEC.md, "Image path"](ts/SPEC.md#image-path) has the conversion and the store.

## Before Cria commands the rig

The checks on errai so far were read-only. [ts/README.md, "Before trying it on the rig"](../ts/README.md#before-trying-it-on-the-rig) lists what has to happen first, and the first session is with Chris present.


## Boot order

Cria listens on errai's tailnet address, which does not exist until tailscale is up, so the first starts at boot fail with `EADDRNOTAVAIL`. The three units set `StartLimitIntervalSec=0` (and `RestartSec=3`), so systemd keeps retrying until the address is there instead of giving up after five tries. Found on errai's first reboot, 2026-10-16.
