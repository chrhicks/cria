# Running Cria on errai

Cria runs on errai, the rig's mini PC (Intel N150) on Arch Linux. Three programs run there:

- `indiserver` owns the drivers, one process each: `indi_asi_ccd` (both ZWO cameras), `indi_asi_focuser` (the EAF), `indi_lx200am5` (the AM5) and `indi_pegasus_ppba` (the Pegasus power box). It listens on TCP 7624.
- Cria is a Node process. It connects to `indiserver` at `127.0.0.1:7624` as an INDI client and serves `/health` and `/connect` on port 4319.
- The rig supervisor is a small Node script beside them. It brings devices up as they are powered.

[The architecture](architecture.md) says what each part owns. [SPEC.md](ts/SPEC.md) is the contract.

## The layout in `ts/deploy`

Three systemd **user** units, all `WantedBy=default.target`. errai has linger on, so they start at boot without a login.

- `indiserver.service` runs `indiserver -v -r 0 -p 7624 -f %t/indi.fifo indi_asi_ccd indi_asi_focuser indi_lx200am5 indi_pegasus_ppba`, with `Restart=always`. Its `ExecStartPost` runs `indi-ready.sh`, which keeps the unit starting until indiserver answers and every driver runs. `-r 0` stops indiserver from restarting a crashed driver by itself. `-f` makes it read `start <driver>` and `stop <driver>` lines from a FIFO (`$XDG_RUNTIME_DIR/indi.fifo`), so one driver can be restarted alone.
- `cria.service` starts after `indiserver.service` (`Wants=` and `PartOf=`) with `Restart=always`. Check its `ExecStart` paths against where Cria is built on errai. Cria does not need indiserver up when it starts: it retries the INDI connection until it succeeds.
- `rig-supervisor.service` starts after `cria.service` with `Restart=always`, and is also `PartOf=indiserver.service`.
- `rig.errai.json` is errai's Cria configuration. `supervisor.example.json` is the supervisor's.
- `phd2.service`, `phd2-profile.mjs`, `phd2-rpc.mjs` and `phd2-guard.nft` set up PHD2 (below). PHD2 is not part of Cria.

## Install on errai

```sh
cd <the Cria checkout on errai>
mkdir -p ~/.config/systemd/user ~/.config/cria
cp ts/deploy/*.service ~/.config/systemd/user/
cp ts/deploy/supervisor.example.json ~/.config/cria/supervisor.json   # then edit it
systemctl --user daemon-reload
systemctl --user enable --now indiserver cria rig-supervisor
```

Keep the `ExecStart` of an existing `cria.service` if it differs from the repo's: the units are templates. Stop a hand-started `indiserver` first, or the unit cannot bind port 7624. Check with `systemctl --user status indiserver cria rig-supervisor` and `journalctl --user -u rig-supervisor -f`.

In `supervisor.json`, use errai's real serial by-id paths for the mount and the Pegasus, and list every device a driver serves under that driver's name.

## Power-up in any order

The mini PC may boot before the rest of the rig has power. Nothing is started by hand:

1. `indiserver`, Cria and the supervisor start at boot.
2. `indi_lx200am5` and `indi_pegasus_ppba` always define their device, but connecting fails until the serial port exists. When it appears, the supervisor sends `POST /connect`; Cria writes the port, connects, and sets the device up.
3. `indi_asi_ccd` and `indi_asi_focuser` define a device only if the USB device is present when the driver starts. When one is powered later, the supervisor restarts that driver, then connects the device the same way.
4. A device that is connected but not yet set up in this Cria instance (after a Cria restart, say) gets the same `POST /connect` within about two polls (roughly 10 s).

Each step waits for the picture to hold for two polls so a device that has just enumerated does not cause a restart.

## The rig supervisor

`ts/deploy/rig-supervisor.mjs` is the one thing that restarts a driver or asks Cria to connect a device. Every 5 s it reads the rig and does two things.

**What it reads.** The drivers, through its own INDI connection to indiserver (`@cria/indi`): per device, whether indiserver defines it, whether `CONNECTION` is connected, disconnected or changing, and which properties are `Busy`. From Cria only `GET /health`, for `instanceId`. It does not read the rig stream: the broker is on thuban, and bring-up must not depend on thuban.

**Restart a driver.** A configured device that indiserver does not define, whose hardware is present (a USB `vid:pid` in sysfs, or the serial path), gets its driver restarted, unless any property of any device that driver serves is `Busy`. The supervisor writes `stop <driver>`, waits 1 s, then writes `start <driver>` to the FIFO. Repeats back off at 20 s, then 30 s, then 60 s, and the count resets once the device is defined.

**Connect a device.** A defined device whose hardware is present gets one `POST /connect {deviceId, connected: true}` when it is disconnected, or connected but not set up in the current Cria instance. The supervisor waits for the answer, up to `connectRequestTimeoutMs`. `confirmed` records the device as set up for that `instanceId`. Any other answer, or none, is logged and retried after 10 s, 30 s, then 60 s. The record clears when the device disappears, `CONNECTION` goes off, the supervisor's INDI link drops, or `instanceId` changes.

It does nothing while Cria is unreachable, and for the restart, while indiserver is unreachable or defines none of the configured devices. It never switches power. It logs one line per decision to stdout.

**Configuration** is `~/.config/cria/supervisor.json` (or the first argument, or `RIG_SUPERVISOR_CONFIG`):

```json
{
  "criaUrl": "http://127.0.0.1:4319",
  "devices": [
    { "id": "primary", "indiDevice": "ZWO CCD ASI2600MC Pro", "usb": "03c3:260a", "driver": "indi_asi_ccd" },
    { "id": "mount", "indiDevice": "ZWO AM5", "serial": "/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_123456-if00" }
  ]
}
```

`id` is a Cria device id and `indiDevice` its INDI name. Each device has exactly one hardware check, `usb` or `serial`, and a `driver` only with `usb`. Every other setting is optional and described in `settings` at the top of the script.

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
| It listens on TCP `4400 + instance - 1`, bound with `wxIPV4address::Service(port)` and no host, so on every interface. The same `ServerMode` also starts PHD2's older socket server on `4300 + instance - 1`, bound the same way, which takes one-byte commands (pause, resume, dither, ...). Switching `ServerMode` off would stop both. | `event_server.cpp` `EventServerStart`; `socket_server.cpp` `StartServer`; `myframe.cpp` `MyFrame` constructor |
| A request is one JSON object per line ending in `\n`. A reply or event is one JSON line ending in `\r\n`. A new client first gets catch-up events (`Version`, `AppState`, ...). | `event_server.cpp` `handle_cli_input`, `send_catchup_events`, `do_notify` |
| `guide` takes `{settle: {pixels, time, timeout}, recalibrate}` and `dither` takes `{amount, raOnly, settle}`. A settle object without all three of `pixels`, `time` and `timeout` is refused. The call answers at once; the outcome comes later as a `SettleDone` event (`Status` 0 is success, otherwise `Error`). | `event_server.cpp` `guide`, `dither`, `parse_settle`, `ev_settle_done` |
| `set_connected`, `loop`, `find_star`, `stop_capture` and `get_app_state` exist. `find_star` is PHD2's automatic star selection. No call builds a dark library. | `event_server.cpp` method table |
| Settings are `wxConfig("PHDGuidingV2")` (instance N above 1 adds `-instanceN`). On Linux that is the INI file `~/.PHDGuidingV2`: root keys, then `[group/sub]` headers, then `key=value`. | `phdconfig.cpp` `ConfigName`; the file path is wxWidgets 3.2 behaviour, not PHD2 source |
| A profile lives under `profile/<id>/`. The global `currentProfile` picks it. A missing `ConfigVersion` makes PHD2 open its modal first-run wizard at start, and so does a single profile whose camera and mount are both `None`. Headless, that dialog would hang PHD2. | `phdconfig.cpp` `PhdConfig`, `InitializeProfile`; `phd.cpp` `OnInit`; `gear_dialog.cpp` `IsEmptyProfile` |
| Camera and mount choices are the strings `INDI Camera [<name>]` and `INDI Mount [<name>]` in `camera/LastMenuChoice` and `scope/LastMenuChoice`, with the INDI names in `indi/INDIcam` and `indi/INDImount`. (The wizard writes `LastMenuchoice` with a lowercase c, which nothing reads. This file uses the spelling `gear_dialog.cpp` reads.) | `camera.cpp` `INDICamName`; `scope.cpp` `INDIMountName`; `cam_indi.cpp`, `scope_indi.cpp`; `gear_dialog.cpp` |
| Other keys: `indi/INDIhost`, `indi/INDIport`, `indi/INDIcam_ccd`, `camera/pixelsize`, `frame/focalLength` (mm), `ExposureDurationMs`, `guider/multistar/enabled`, and the global `Update/enabled` (the update check). | `cam_indi.cpp`, `camera.cpp`, `myframe.cpp`, `guider_multistar.cpp`, `phdupdate.cpp` |
| PHD2 also connects an auxiliary mount, an adaptive optics unit and a rotator from `scope/LastAuxMenuChoice`, `stepguider/LastMenuChoice` and `rotator/LastMenuChoice`. The writer sets all three to `None`. | `gear_dialog.cpp`, `profile_wizard.cpp` `WrapUp` |
| Without a profile wizard the calibration pulse stays at 750 ms. The wizard stores `scope/CalibrationDistance` (the larger of 25 px and 20 arcsec) and `scope/CalibrationDuration` (the pulse that covers it in 12 steps at the mount's guide rate, rounded up to 50 ms). The writer stores the same numbers: 25 px and 1550 ms for 150 mm, 4 um and a guide rate of 0.5x. | `scope.cpp`, `calstep_dialog.cpp` `GetCalibrationDistance`, `GetCalibrationStepSize`; `profile_wizard.cpp` |
| Settle tolerance is an argument of `guide` and `dither`, not a profile key. Star selection is the `find_star` call, not a profile key. | `event_server.cpp` |
| The dark library file is `darks_defects/PHD2_dark_lib_<profileId>.fit` inside PHD2's local data directory (`wxStandardPaths::GetUserLocalDataDir`, which PHD2 names with its app name `phd2`; with wxWidgets' classic layout that is `~/.phd2`, not checked on errai). It loads on camera connect (`camera/AutoLoadDarks`, default true). | `myframe.cpp` `GetDarksDir`, `DarkLibFileName`, `GetDefaultFileDir`; `gear_dialog.cpp` `AutoLoadDarks` |
| `stop_capture` answers `0` at once, even when an exposure is still running and PHD2 is only waiting for it. `get_app_state` returns `Stopped` when PHD2 is done. | `event_server.cpp` `stop_capture`; `myframe.cpp` `StopCapturing` |
| The Darks menu is "Dark Library..."; the dialog is "Build Dark Library" with Min and Max Exposure Time, "Frames to take for each exposure time", and the options "Modify/extend" and "Create entirely new". It asks you to cover the guide scope. | `myframe.cpp`, `darks_dialog.cpp` |

### Ports 4300 and 4400 listen on every interface

PHD2 does not offer a bind address. Anyone who can reach port 4400 can start and stop guiding, make the mount take guide pulses and send `shutdown`; port 4300 takes pause, resume and dither. The plan says only errai itself may reach PHD2, so **do not enable `phd2.service` until both ports are closed to everything but errai**. On 2026-10-24 no firewall service on errai was active (`systemctl is-active` said inactive for `nftables`, `ufw`, `iptables` and `firewalld`). Rules loaded by hand would not show there, and reading them needs root, so check with `sudo nft list ruleset`. `ts/deploy/phd2-guard.nft` holds the rule and `ts/deploy/phd2-guard.service` is a system unit that loads it at boot, before the network comes up. Install them on errai, by Chris or with his go-ahead (done on 2026-10-25):

```sh
sudo install -m 644 ts/deploy/phd2-guard.nft /etc/phd2-guard.nft
sudo install -m 644 ts/deploy/phd2-guard.service /etc/systemd/system/phd2-guard.service
sudo systemctl daemon-reload
sudo systemctl enable --now phd2-guard
sudo nft list table inet phd2_guard
```

The rule drops TCP 4300 and 4400 unless the packet arrives on `lo`. The unit touches only its own table: `systemctl stop phd2-guard` deletes `inet phd2_guard` and nothing else. **Do not use `nftables.service` for this.** On errai `/etc/nftables.conf` is Arch's stock firewall, which drops all input except ssh, so enabling that service would cut Vela off from Cria (4319) and INDI (7624). A unit of its own also keeps the rule separate from any later firewall: stopping it removes only this table.

Check it with PHD2 running. On errai: `ss -ltnp | grep -E ':(4300|4400) '` shows PHD2 listening. From thuban (no `nc` there): `timeout 5 bash -c 'exec 3<>/dev/tcp/HOST/4400'` and the same for 4300 must both fail, for errai's LAN address and its tailnet name, while 4319 and 7624 still connect, and `ssh errai 'node ts/deploy/phd2-rpc.mjs watch 2'` must still print a `Version` event. Cria will reach PHD2 on `127.0.0.1:4400`.

### Install

```sh
sudo pacman -S x11vnc                      # once; only used to look at PHD2
cd <the Cria checkout on errai>
cp ts/deploy/phd2.service ~/.config/systemd/user/
systemctl --user daemon-reload
node ts/deploy/phd2-profile.mjs --dry-run  # prints the file it would write
node ts/deploy/phd2-profile.mjs            # writes ~/.PHDGuidingV2
systemctl --user enable --now phd2          # only after ports 4300 and 4400 are closed (above)
```

`phd2-profile.mjs` sets the profile "Cria guide": INDI server `localhost:7624`, camera `ZWO CCD ASI220MM Mini`, mount `ZWO AM5` (pulses over INDI, no ST4 cable), no auxiliary mount, adaptive optics or rotator, focal length 150 mm, pixel size 4 um, 2 s exposures, multi-star on, the calibration pulse and distance the PHD2 wizard would pick (1550 ms, 25 px), the update check off, and it selects the profile. It sets only those keys. A calibration, tuned algorithm settings or another profile in the file stay as they are, so it is safe to run again; when nothing changes it does nothing. It refuses to run while a process called `phd2` or `phd2.bin` exists, because PHD2 rewrites the file when it exits. Before it changes an existing file it copies the file to `~/.PHDGuidingV2.cria-backup-<time>`. `--file PATH` points it elsewhere.

The unit needs `xvfb-run` and `xauth` (errai has both). `xvfb-run` starts Xvfb on `:99` with its X authority in `$XDG_RUNTIME_DIR/phd2.xauth`, then PHD2. If PHD2 exits, `xvfb-run` stops Xvfb and systemd restarts both after 5 s. `systemctl --user stop phd2` stops both. Logs: `journalctl --user -u phd2`, Xvfb's output in `$XDG_RUNTIME_DIR/phd2-xvfb.log`, and PHD2's own debug and guide logs in `<Documents>/PHD2/` (`logger.cpp` `DefaultDir`). errai has no `~/.config/user-dirs.dirs`, so wxWidgets falls back to the home directory and the logs are in `~/PHD2/` (read from wxWidgets 3.2 behaviour, not checked by running PHD2).

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
6. Check that the file exists: `find ~ -name 'PHD2_dark_lib_*.fit'` (expected `~/.phd2/darks_defects/PHD2_dark_lib_<id>.fit`, where `<id>` is the profile number `phd2-profile.mjs` printed). PHD2 loads it whenever the camera connects.

The dark depends on the sensor temperature. Build it at the temperature of the night it is used for. Rebuild it if the camera's temperature differs a lot on another night (a guess, not tested).

### Step script

`phd2-rpc.mjs` connects to `127.0.0.1:4400` only (`--port` changes the port; there is no host option, because PHD2 stays on errai), prints every line PHD2 sends, and sends exactly the one request its subcommand names. It starts nothing on its own and stays connected only until that step is answered.

| Command | Sends | Waits for |
|---|---|---|
| `watch [SECONDS]` | nothing | SECONDS (30), then exits 0 |
| `state` | `get_app_state` | the reply |
| `connect` | `set_connected` true | the reply (up to 120 s) |
| `loop` | `loop` | the reply |
| `find-star` | `find_star` | the reply (the star position, or an error) |
| `guide` | `guide` with settle 1.5 px, 10 s, timeout 90 s; `--recalibrate` to force a calibration | the `SettleDone` event (up to 900 s, because the first calibration runs before the settle clock starts) |
| `dither` | `dither` 3 px (change with `--pixels`), both axes, same settle | the `SettleDone` event (up to 120 s) |
| `stop` | `stop_capture`, then `get_app_state` (a read) once a second | `Stopped`, because PHD2 answers `stop_capture` before an exposure in progress has ended (up to 30 s) |
| `disconnect` | `set_connected` false | the reply |

The exit code is 0 when the step worked, 1 for bad arguments and 2 when PHD2 refused, did not settle, did not answer within `--wait` seconds or could not be reached. A timeout or a lost connection leaves the outcome unknown: PHD2 keeps doing what it was asked, and the script says so. Run `state`, and do not run the step again until you know where PHD2 is. The script never retries, never stops anything on its own and never starts PHD2. Run it with no arguments for the usage line.

### Night-of checklist (supervised, with Chris at the rig)

Preconditions: a clear sky; the mount tracking and polar aligned; the target framed by Vela; the guide scope focused; dew control on the guide scope (the Pegasus Dew B port is free); `cria`, `indiserver` and `rig-supervisor` running; nothing exposing on the guide camera. Cria must not take pictures with the guide camera while PHD2 guides, and has no guider device yet, so do not start any capture on `ZWO CCD ASI220MM Mini` from Cria or Vela during this test. The main camera (ASI2600) can keep exposing. Both cameras share one INDI driver process (`indi_asi_ccd`), so watch the main camera's frames during the first PHD2 exposures in case one camera disturbs the other (not tested on Linux).

1. Close ports 4300 and 4400 to everything but errai (the rule above), before enabling the unit.
2. Install as above. Check `systemctl --user status phd2`, then `ss -ltnp | grep 4400` on errai. PHD2 shows as `phd2.bin`. If it is not listening 20 s after the unit starts, read `journalctl --user -u phd2` and look at PHD2 over x11vnc: a dialog that waits for a click is the usual cause.
3. `node ts/deploy/phd2-rpc.mjs watch 5` prints a `Version` event. `state` returns `Stopped`.
4. `connect`. Expect a result and, in `journalctl`, no INDI errors. `state` returns `Stopped` still. Cria should show the guide camera and the mount as before.
5. Dark library (first time only), as above. Then `connect` again if the camera was disconnected.
6. `loop`. Events with `Event":"LoopingExposures"` appear about every 2 s. `find-star` returns `[x, y]`. If it fails, look through x11vnc, and make sure the guide scope is on stars and focused.
7. `guide`. The first time PHD2 calibrates (events `Calibrating`, then `CalibrationComplete`), which takes a few minutes, and then settles. PHD2's usual advice is to calibrate near the celestial equator and the meridian (general PHD2 advice, not checked in the source). Exit 0 means `SettleDone` with `Status` 0. Let it guide for 10 minutes and note the RMS from the `GuideStep` events. The unguided frames of 2026-10-23 trailed in RA on about 1 frame in 3 with a period near 4.9 min.
8. `dither`. Exit 0 within 90 s. Repeat twice. A `SettleDone` with `Status` 1 means it did not settle; read its `Error`.
9. `stop` (it returns once `state` says `Stopped`). `disconnect`.
10. Write down: did it connect, calibrate, guide, dither and stop; the RMS; the dark library path; anything PHD2 put on screen.

After the supervised night, the next steps in the plan are the Cria guider device (readings, then operations) and Vela's capture options.

## Configure Cria

Cria takes one argument, the path to its JSON configuration (`node apps/cria/dist/main.js <config.json>`); `CRIA_CONFIG` is read when it is missing. Keys and defaults are in [SPEC.md](ts/SPEC.md#configuration). `listen.host` is `127.0.0.1`, so only errai can reach Cria; set it to errai's tailnet address for a client on another machine.

## Stop and restart

`systemctl stop` sends SIGTERM and Cria exits. A restart is a new Cria with a new `instanceId` and nothing carried over; every device needs `POST /connect` again, which the supervisor sends within about two polls. The INDI drivers keep running and keep their state.

`systemctl --user restart indiserver` restarts everything on errai in lockstep, because `cria.service` and `rig-supervisor.service` are `PartOf=indiserver.service`: systemd stops the supervisor, Cria, indiserver and the drivers, starts indiserver and waits in `indi-ready.sh`, then starts Cria and the supervisor, which connects each device. Use it when a driver stops answering. Restarting `indi_asi_ccd` also stops the camera cooler until the camera is connected again and the cooler is turned back on.

## Logs

Cria writes to stderr, so journald holds its log: `cria: instance <id> listening on <port>` at start and `cria: SIGTERM, stopping` at stop.

## Boot order

Cria may listen on errai's tailnet address, which does not exist until tailscale is up, so the first starts at boot can fail with `EADDRNOTAVAIL`. The three units set `StartLimitIntervalSec=0` and `RestartSec=3`, so systemd keeps retrying (errai's first reboot, 2026-10-16).
