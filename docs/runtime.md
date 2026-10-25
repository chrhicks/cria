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
- `phd2.service`, `phd2-profile.mjs` and `phd2-rpc.mjs` set up PHD2 for guiding (see "PHD2 on errai" below). PHD2 is not part of Cria, and nothing in Cria talks to it yet.

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

## PHD2 on errai

PHD2 does the guiding. It runs on errai next to Cria as rig equipment, headless, and nobody looks at it. The plan is in `bots/observer/specs/rig-guiding.md` of Chris's `home` repo (decided 2026-10-24): a later Cria `guider` device will drive PHD2 over its JSON-RPC port, and Vela will ask Cria for guiding and dithering. This section covers only the errai side: a unit, a profile writer and a step script. Cria has no PHD2 code yet.

Three files in `ts/deploy` do it:

- `phd2.service` runs `phd2` under `xvfb-run` on a fixed display `:99`, with the event server on. It is ordered after `indiserver.service`.
- `phd2-profile.mjs` writes the equipment profile into PHD2's config file. No GUI.
- `phd2-rpc.mjs` runs one named JSON-RPC step against PHD2 and prints what PHD2 sends. It is for a supervised night.

### What was read from PHD2 and where

All of this is from the PHD2 2.6.14 source (tag `v2.6.14`, `src/` in https://github.com/OpenPHDGuiding/phd2) unless the last column says otherwise. errai has the Arch package `phd2 2.6.14-1` on wxWidgets 3.2.12.

| Fact | Source |
|---|---|
| Command line has only `-i N` (instance), `-l FILE`, `-s FILE`, `-R`, `-v`, `-?`. There is no headless flag, so PHD2 needs an X display. | `phd.cpp` `cmdLineDesc` |
| The event server is on when the global key `ServerMode` is true. The default is true. | `myframe.cpp` `DefaultServerMode`, `MyFrame` constructor |
| It listens on TCP `4400 + instance - 1`, bound with `wxIPV4address::Service(port)` and no host, so on every interface. | `event_server.cpp` `EventServerStart` |
| A request is one JSON object per line ending in `\n`. A reply or event is one JSON line ending in `\r\n`. A new client first gets catch-up events (`Version`, `AppState`, ...). | `event_server.cpp` `handle_cli_input`, `send_catchup_events`, `do_notify` |
| `guide` takes `{settle: {pixels, time, timeout}, recalibrate}` and `dither` takes `{amount, raOnly, settle}`. A settle object without all three of `pixels`, `time` and `timeout` is refused. The call answers at once; the outcome comes later as a `SettleDone` event (`Status` 0 is success, otherwise `Error`). | `event_server.cpp` `guide`, `dither`, `parse_settle`, `ev_settle_done` |
| `set_connected`, `loop`, `find_star`, `stop_capture` and `get_app_state` exist. `find_star` is PHD2's automatic star selection. No call builds a dark library. | `event_server.cpp` method table |
| Settings are `wxConfig("PHDGuidingV2")` (instance N above 1 adds `-instanceN`). On Linux that is the INI file `~/.PHDGuidingV2`: root keys, then `[group/sub]` headers, then `key=value`. | `phdconfig.cpp` `ConfigName`; the file path is wxWidgets 3.2 behaviour, not PHD2 source |
| A profile lives under `profile/<id>/`. The global `currentProfile` picks it. A missing `ConfigVersion` makes PHD2 open its modal first-run wizard at start, and so does a single profile whose camera and mount are both `None`. Headless, that dialog would hang PHD2. | `phdconfig.cpp` `PhdConfig`, `InitializeProfile`; `phd.cpp` `OnInit`; `gear_dialog.cpp` `IsEmptyProfile` |
| Camera and mount choices are the strings `INDI Camera [<name>]` and `INDI Mount [<name>]` in `camera/LastMenuChoice` and `scope/LastMenuChoice`, with the INDI names in `indi/INDIcam` and `indi/INDImount`. (The wizard writes `LastMenuchoice` with a lowercase c, which nothing reads. This file uses the spelling `gear_dialog.cpp` reads.) | `camera.cpp` `INDICamName`; `scope.cpp` `INDIMountName`; `cam_indi.cpp`, `scope_indi.cpp`; `gear_dialog.cpp` |
| Other keys: `indi/INDIhost`, `indi/INDIport`, `indi/INDIcam_ccd`, `camera/pixelsize`, `frame/focalLength` (mm), `ExposureDurationMs`, `guider/multistar/enabled`, and the global `Update/enabled` (the update check). | `cam_indi.cpp`, `camera.cpp`, `myframe.cpp`, `guider_multistar.cpp`, `phdupdate.cpp` |
| Settle tolerance is an argument of `guide` and `dither`, not a profile key. Star selection is the `find_star` call, not a profile key. | `event_server.cpp` |
| The dark library file is `<Documents>/PHD2/darks_defects/PHD2_dark_lib_<profileId>.fit`. It loads on camera connect (`camera/AutoLoadDarks`, default true). | `myframe.cpp` `DarkLibFileName`; `gear_dialog.cpp` `AutoLoadDarks` |
| The Darks menu is "Dark Library..."; the dialog is "Build Dark Library" with Min and Max Exposure Time, "Frames to take for each exposure time", and the options "Modify/extend" and "Create entirely new". It asks you to cover the guide scope. | `myframe.cpp`, `darks_dialog.cpp` |

### Port 4400 listens on every interface

PHD2 does not offer a bind address. Anyone who can reach port 4400 can start and stop guiding, make the mount take guide pulses and send `shutdown`. On 2026-10-24 errai had no active firewall (`nftables`, `ufw`, `iptables` and `firewalld` all inactive), so the port is open to the LAN and the tailnet as soon as `phd2.service` runs. Nothing in this repo changes the firewall. Decide before the supervised night, and keep it on errai only:

```sh
sudo nft add table inet phd2_guard
sudo nft add chain inet phd2_guard input '{ type filter hook input priority 0; policy accept; }'
sudo nft add rule inet phd2_guard input tcp dport 4400 iifname != lo drop
```

This is not persistent; add it to `/etc/nftables.conf` and enable `nftables.service` to keep it across a reboot. Check it from thuban: `nc -zv -w 3 errai.local 4400` must fail while `ssh errai ss -ltnp | grep 4400` shows PHD2 listening. Cria will reach PHD2 on `127.0.0.1:4400`.

### Install

```sh
sudo pacman -S x11vnc                      # once; only used to look at PHD2
cd <the Cria checkout on errai>
cp ts/deploy/phd2.service ~/.config/systemd/user/
systemctl --user daemon-reload
node ts/deploy/phd2-profile.mjs --dry-run  # prints the file it would write
node ts/deploy/phd2-profile.mjs            # writes ~/.PHDGuidingV2
systemctl --user enable --now phd2
```

`phd2-profile.mjs` sets the profile "Cria guide": INDI server `localhost:7624`, camera `ZWO CCD ASI220MM Mini`, mount `ZWO AM5` (pulses over INDI, no ST4 cable), focal length 150 mm, pixel size 4 um, 2 s exposures, multi-star on, the update check off, and it selects the profile. It sets only those keys. A calibration, tuned algorithm settings or another profile in the file stay as they are, so it is safe to run again; when nothing changes it does nothing. It refuses to run while a process called `phd2` or `phd2.bin` exists, because PHD2 rewrites the file when it exits. Before it changes an existing file it copies the file to `~/.PHDGuidingV2.cria-backup-<time>`. `--file PATH` points it elsewhere.

The unit needs `xvfb-run` and `xauth` (errai has both). `xvfb-run` starts Xvfb on `:99` with its X authority in `$XDG_RUNTIME_DIR/phd2.xauth`, then PHD2. If PHD2 exits, `xvfb-run` stops Xvfb and systemd restarts both after 5 s. `systemctl --user stop phd2` stops both. Logs: `journalctl --user -u phd2`, Xvfb's output in `$XDG_RUNTIME_DIR/phd2-xvfb.log`, and PHD2's own debug and guide logs in `~/Documents/PHD2/` (`logger.cpp` `DefaultDir`).

### Looking at PHD2 with x11vnc

The unit runs no VNC server. To look at PHD2 (a dialog it opened, a star it will not pick, the dark library), start x11vnc by hand on errai for as long as needed and stop it with Ctrl-C:

```sh
x11vnc -display :99 -auth $XDG_RUNTIME_DIR/phd2.xauth -localhost -nopw -rfbport 5900 -forever
```

`-localhost` keeps it off the network. From thuban: `ssh -L 5900:localhost:5900 errai`, then open a VNC viewer on `localhost:5900`. Anything done in the viewer is done in PHD2, so change nothing while a run is guiding.

### The dark library

The ASI220MM Mini is uncooled and no PHD2 call builds a dark library in 2.6.14, so it is built once by hand, on the first supervised night, over x11vnc. It is not automated. Do it with the profile written, PHD2 running and the camera connected (`phd2-rpc.mjs connect`):

1. Cover the guide scope with its cap. (PHD2 asks for this too.)
2. Open x11vnc as above. In PHD2 choose Darks, then "Dark Library...".
3. Set Min Exposure Time and Max Exposure Time to cover the exposures guiding will use. The profile uses 2 s, so 1 s to 3 s is enough. Set "Frames to take for each exposure time" to about 10 (a guess; PHD2's default is what it offers).
4. Choose "Create entirely new dark library", press Start, and wait for "dark library built".
5. Take the cap off.
6. Check that `~/Documents/PHD2/darks_defects/PHD2_dark_lib_<id>.fit` exists. `<id>` is the profile number `phd2-profile.mjs` printed. PHD2 loads it whenever the camera connects.

The dark depends on the sensor temperature. Build it at the temperature of the night it is used for. Rebuild it if the camera's temperature differs a lot on another night (a guess, not tested).

### Step script

`phd2-rpc.mjs` connects to `127.0.0.1:4400` (change with `--port` and `--host`), prints every line PHD2 sends, and sends exactly the one request its subcommand names. It starts nothing on its own and stays connected only until that step is answered.

| Command | Sends | Waits for |
|---|---|---|
| `watch [SECONDS]` | nothing | SECONDS (30), then exits 0 |
| `state` | `get_app_state` | the reply |
| `connect` | `set_connected` true | the reply (up to 120 s) |
| `loop` | `loop` | the reply |
| `find-star` | `find_star` | the reply (the star position, or an error) |
| `guide` | `guide` with settle 1.5 px, 10 s, timeout 90 s; `--recalibrate` to force a calibration | the `SettleDone` event |
| `dither` | `dither` 3 px (change with `--pixels`), both axes, same settle | the `SettleDone` event |
| `stop` | `stop_capture` | the reply |
| `disconnect` | `set_connected` false | the reply |

The exit code is 0 when the step worked, 1 for bad arguments and 2 when PHD2 refused, did not settle, did not answer within `--wait` seconds or could not be reached. Exiting does not undo anything: after a timeout or Ctrl-C, PHD2 keeps doing what it was asked until `stop`. Run `node ts/deploy/phd2-rpc.mjs` with no arguments for the usage line.

### Night-of checklist (supervised, with Chris at the rig)

Preconditions: a clear sky; the mount tracking and polar aligned; the target framed by Vela; the guide scope focused; dew control on the guide scope (the Pegasus Dew B port is free); `cria`, `indiserver` and `rig-supervisor` running; nothing exposing on the guide camera. Cria must not take pictures with the guide camera while PHD2 guides, and has no guider device yet, so do not start any capture on `ZWO CCD ASI220MM Mini` from Cria or Vela during this test. The main camera (ASI2600) can keep exposing. Both cameras share one INDI driver process (`indi_asi_ccd`), so watch the main camera's frames during the first PHD2 exposures in case one camera disturbs the other (not tested on Linux).

1. Decide the firewall rule above (done or consciously skipped).
2. Install as above. Check `systemctl --user status phd2`, then `ss -ltnp | grep 4400` on errai. PHD2 shows as `phd2.bin`. If it is not listening 20 s after the unit starts, read `journalctl --user -u phd2` and look at PHD2 over x11vnc: a dialog that waits for a click is the usual cause.
3. `node ts/deploy/phd2-rpc.mjs watch 5` prints a `Version` event. `state` returns `Stopped`.
4. `connect`. Expect a result and, in `journalctl`, no INDI errors. `state` returns `Stopped` still. Cria should show the guide camera and the mount as before.
5. Dark library (first time only), as above. Then `connect` again if the camera was disconnected.
6. `loop`. Events with `Event":"LoopingExposures"` appear about every 2 s. `find-star` returns `[x, y]`. If it fails, look through x11vnc, and make sure the guide scope is on stars and focused.
7. `guide`. The first time PHD2 calibrates (events `Calibrating`, then `CalibrationComplete`), which takes a few minutes, and then settles. PHD2's usual advice is to calibrate near the celestial equator and the meridian (general PHD2 advice, not checked in the source). Exit 0 means `SettleDone` with `Status` 0. Let it guide for 10 minutes and note the RMS from the `GuideStep` events. The unguided frames of 2026-10-23 trailed in RA on about 1 frame in 3 with a period near 4.9 min.
8. `dither`. Exit 0 within 90 s. Repeat twice. A `SettleDone` with `Status` 1 means it did not settle; read its `Error`.
9. `stop`, then `state` returns `Stopped`. `disconnect`.
10. Bring the answers to Chris: did it connect, calibrate, guide, dither and stop; the RMS; the dark library path; anything PHD2 put on screen.

After the supervised night, the next steps in the plan are the Cria guider device (readings, then operations) and Vela's capture options.

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

## Recording

With `record` in the config (absent on errai until it is measured and enabled), Cria writes a recording of its INDI traffic into `record.dir`: one folder per Cria start, with a manifest, a `traffic.jsonl`, and one file per camera frame. Frames are the full FITS, about 52 MB each for the ASI2600, so size `reserveGb` and `queueMb` from the disk's measured speed and free space. Recording stops for the rest of a run when its queue is full, the disk would drop below `reserveGb`, or a write fails, and Cria carries on. [SPEC.md, "Recording"](ts/SPEC.md#recording) has the format and the failure rules. To check a recording, run `verifyRecording` from `@cria/recording` on its folder; a missing `end` line means Cria died.

## Before Cria commands the rig

The checks on errai so far were read-only. [ts/README.md, "Before trying it on the rig"](../ts/README.md#before-trying-it-on-the-rig) lists what has to happen first, and the first session is with Chris present.


## Boot order

Cria listens on errai's tailnet address, which does not exist until tailscale is up, so the first starts at boot fail with `EADDRNOTAVAIL`. The three units set `StartLimitIntervalSec=0` (and `RestartSec=3`), so systemd keeps retrying until the address is there instead of giving up after five tries. Found on errai's first reboot, 2026-10-16.
