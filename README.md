# Cria

Cria is TypeScript on Node 26 that runs the rig's software on errai (the rig PC, Intel N150, Arch) and the tools that read it on thuban. Node runs the `.ts` files directly; there is no build.

## What runs where

| Program | Where | What it does |
| --- | --- | --- |
| `indiserver` | errai | Owns the drivers, one process each, and listens on 7624. `-r 0`: it never restarts a crashed driver |
| `rig-supervisor` (`src/bin/rig.ts`, the rig program) | errai | Owns bring-up: compares INDI with the rig file every 5 s and writes what differs. Restarts a driver whose device is missing while its hardware is present, or whose serial link is dead, when nothing it serves is Busy |
| `rig-stream-client` | errai | Publishes the raw INDI traffic, the system journal and PHD2's events to the rig stream (NATS JetStream on thuban). It also carries the rig program's writes: indiserver relays every client's `new*Vector` to the others |
| `rig-stream-viewer` | thuban | A web page of the stream |
| `phd2` | errai | Guiding, headless; see [docs/phd2.md](docs/phd2.md) |

Entry points are `ts/src/bin/{rig,recorder,viewer}.ts`; each unit in `ts/deploy/` runs one.

## Layout (`ts/`)

| Folder | Contents |
| --- | --- |
| `src/indi` | INDI client, property mirror, XML, problem log, traffic tap ([README](ts/src/indi/README.md)) |
| `src/stream` | Entry format, subjects, publisher, broker login |
| `src/rig` | The rig file, the decision (`reconcile.ts`, a pure function), the loop that carries it out, the INDI link, the FIFO |
| `src/recorder` | The rig stream client: journal, PHD2, INDI wire |
| `src/viewer` | The stream viewer and its page |
| `deploy` | systemd units, `indi-ready.sh`, PHD2 profile and step scripts |
| `testing` | The real-`indiserver` helper, the fake INDI server, PHD2 script tests |

## Test

You need Node 26, pnpm and libindi with `indiserver` and `indi_simulator_focus`.

```sh
cd ts
pnpm install
./verify.sh
```

`verify.sh` runs the typecheck (which covers every test file) and every test, and exits with the failing stage's exit code. Read that code itself; never pipe the script. No test touches hardware.

## Deploy

errai keeps its checkout at `~/dev/personal/cria-ts`; the units are templates that point there.

```sh
cd ~/dev/personal/cria-ts && git pull
cd ts && pnpm install --frozen-lockfile --prod
mkdir -p ~/.config/systemd/user
cp deploy/{rig-supervisor,rig-stream-client,indiserver,phd2}.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart rig-supervisor rig-stream-client
```

Configuration lives outside the repo on errai: `~/.config/cria/rig.json` (the rig file) and `~/.config/rig-stream/client.json` (recorder). Each setting's description, with the evidence behind its default, is in `src/rig/config.ts` and `src/recorder/config.ts`. An unknown key or invalid value stops the program at start. The site coordinates live only in the rig file on errai, never in the repo.

thuban's viewer runs from its own checkout so development never changes it:

```sh
git clone "$(git -C ~/dev/personal/cria remote get-url origin)" ~/dev/personal/cria-run
cd ~/dev/personal/cria-run/ts && pnpm install --frozen-lockfile --prod
cp deploy/rig-stream-viewer.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart rig-stream-viewer
```

`systemctl --user restart indiserver` restarts the rig software as one: `rig-supervisor` is `PartOf` it, and `indi-ready.sh` holds the start until the drivers are up. It also stops the camera cooler until the camera is connected again.

## The rig file

One file describes every device and what it should be. The rig program reads it at start; an unknown key or an invalid value stops it with exit 2.

```json
{
  "devices": [
    { "id": "primary", "indiDevice": "ZWO CCD ASI2600MC Pro", "usb": "03c3:260a", "driver": "indi_asi_ccd", "connected": true,
      "properties": { "UPLOAD_MODE": { "UPLOAD_CLIENT": true } } },
    { "id": "focuser", "indiDevice": "ZWO EAF", "usb": "03c3:1f10", "driver": "indi_asi_focuser", "connected": true },
    { "id": "mount", "indiDevice": "ZWO AM5", "serial": "/dev/serial/by-id/usb-mount", "driver": "indi_lx200am5", "connected": true,
      "properties": {
        "GEOGRAPHIC_COORD": { "LAT": 33.45, "LONG": 247.93, "ELEV": 331 },
        "DEBUG": { "ENABLE": true },
        "DEBUG_LEVEL": { "DBG_DEBUG": true }
      },
      "onConnect": { "TIME_UTC": { "UTC": "now", "OFFSET": "0.00" } } }
  ]
}
```

- `usb` is the `vid:pid` sysfs shows, `serial` the path the device appears at. A serial device's `DEVICE_PORT` is its `serial` path, written before it connects.
- `connected` says whether the device should be connected.
- `properties` are INDI properties the device should hold (element name to number, boolean or text). `LONG` is INDI's 0 to 360, east positive. Numbers match within `numberTolerance`.
- `onConnect` properties are written once each time the device becomes connected, because they can never already hold. A text value of `now` is written as the current UTC time.
- `driver` names the executable the FIFO restarts. Settings that are not in the list of devices (poll interval, thresholds, backoff) are the keys of `settings` in `src/rig/config.ts`, each with its description.

## How the rig comes up

The mini PC may boot before the rest of the rig has power, and nothing is started by hand. Every poll the rig program compares what INDI shows with the rig file and writes only what differs; nothing is a command with an outcome to track. A write that did not take is simply still different at the next poll, and repeats back off at 10 s, then 30 s, then 60 s.

- A device that is disconnected gets its `DEVICE_PORT` (serial devices), then `CONNECTION`, once its hardware has been present for two polls. A device that is connected gets the properties of its table that differ and its `onConnect` properties. A property its driver has not defined yet is not written yet: drivers define most of theirs only after the connection is on.
- `indi_lx200am5` and `indi_pegasus_ppba` always define their device. `indi_asi_ccd` and `indi_asi_focuser` define a device only if its USB device is present when the driver starts, so a device that is missing from INDI while its hardware is present has its driver restarted through the FIFO (`stop`, then `start`), unless a property of any device that driver serves is Busy. Both cameras are served by `indi_asi_ccd`. A restart is repeated at most once in 20 s and backs off at 10 s, 30 s and 60 s.
- A serial device whose driver reports `[ERROR]` messages without a break of 5 s for 30 s is a dead link, although the device still looks connected (11-01 and 11-02: the mount and the box drivers printed `Serial write error: Write Error: Input/output error` two to three times a second for hours). The rig program reconnects the device (`CONNECTION` off, then on). If it is not connected and quiet 60 s later, it restarts that device's driver. The device's own Busy properties do not hold the restart back: a dead mount keeps `TELESCOPE_TRACK_STATE` Busy.
- It never switches power, and none of the properties it writes starts a motion or an exposure. It logs one line per decision, without the values it writes.

Its writes reach the rig stream through the stream client: indiserver relays every client's `new*Vector` to the other clients, and the stream client publishes the raw wire.

## Changing a device by hand

On errai, `indi_setprop "ZWO EAF.CONNECTION.DISCONNECT=On"` writes any property. A property the rig file names is written back at the next poll, and a device the rig file wants connected is connected again: to keep a device off or set a different value, edit `~/.config/cria/rig.json` and `systemctl --user restart rig-supervisor`.

## Ownership of the rig

Who owns the equipment is a live condition. Verify the current owner before the rig program runs against the rig. Agents do not command the real rig unless Chris is present, as [AGENTS.md](AGENTS.md) says.
