# Cria

Cria is TypeScript on Node 26 that runs the rig's software on errai (the rig PC, Intel N150, Arch) and the tools that read it on thuban. Node runs the `.ts` files directly; there is no build.

## What runs where

| Program | Where | What it does |
| --- | --- | --- |
| `indiserver` | errai | Owns the drivers, one process each, and listens on 7624. It starts with no drivers (the rig program starts them through its FIFO) and `-r 0`: it never restarts a crashed driver |
| `rig` (`src/bin/rig.ts`, the rig program) | errai | Owns bring-up: compares INDI with the rig file every 5 s and writes what differs. Restarts a driver whose device is missing while its hardware is present, or whose serial link is dead, when nothing it serves is Busy. Over the same INDI connection it publishes the raw INDI traffic (its own writes included), errai's journal and PHD2's events to the rig stream (NATS JetStream on thuban) |
| `rig-stream-viewer` | thuban | A web page of the stream |
| `phd2` | errai | Guiding, headless; see [docs/phd2.md](docs/phd2.md) |

Entry points are `ts/src/bin/{rig,viewer,ensure-stream}.ts`; each unit in `ts/deploy/` runs one of the first two.

When a connection a program depends on is lost, it exits and systemd starts it again with fresh state (`Restart=always`, with a delay that grows on repeated failure). The rig program does this for indiserver and for an unreadable config; the viewer does it for the broker. The one connection it keeps instead of exiting is the broker's, because bring-up must not wait for thuban: the NATS client reconnects by itself, wire entries are dropped while it is away, and journal lines wait for the stream's acknowledgement before the cursor moves.

## Layout (`ts/`)

| Folder | Contents |
| --- | --- |
| `src/indi` | INDI client (one connection, no reconnect), property mirror, XML, problem log, traffic tap ([README](ts/src/indi/README.md)) |
| `src/stream` | Entry format, subjects, publisher, broker login, the journal and PHD2 followers, and `record.ts`, which the rig program starts |
| `src/rig` | The rig file (a Schema, `config.ts`), the decision (`reconcile.ts`, a pure function), the poll that carries it out, the INDI link, the FIFO |
| `src/viewer` | The stream viewer and its page |
| `deploy` | systemd units, `install.sh`, PHD2 profile and step scripts |
| `testing` | The real-`indiserver` helper, the fake INDI server, PHD2 script tests |

## Stream entries

Every entry is `{ v: 2, id, rig, kind, at, source, body }`. A `wire` entry's body keeps the raw `xml` and carries what the parser read from it: `{ conn, dir, n, xml, device, type, indiDevice?, property?, state?, elements?, text?, tag? }`. `device` is the id from the rig file (`server` when the element names no device, `other` when the rig file does not list it), `type` is `def`, `set`, `new`, `del`, `message`, `other` (`tag` says which: `getProperties`, `pingRequest`, `pingReply`) or `unreadable` (`text` is the problem). Every protocol problem the parser reports (an element it skipped, an element left out of a property, framing it lost and resynchronised) is also a `client.protocol-problem` entry: `{ target: 'indiserver', conn, consequence, scope, reason, tag, indiDevice?, property?, utf8, excerpt, bytes }`, shown in the viewer as a problem. The viewer reads these fields and never the XML; a version 1 wire entry has none of them and is shown as raw XML until it ages out of the stream.

## Test

You need Node 26, pnpm and libindi with `indiserver` and `indi_simulator_focus`.

```sh
cd ts
pnpm install
./verify.sh
```

`verify.sh` runs the typecheck (which covers every test file) and every test, and exits with the failing stage's exit code. Read that code itself; never pipe the script. No test touches hardware.

## Deploy

errai runs the programs from its checkout `~/dev/personal/cria-ts`, thuban's viewer from `~/dev/personal/cria-run`, so development never changes what runs. Each is a clone of this repo. Run the script from that checkout:

```sh
ssh errai '~/dev/personal/cria-ts/ts/deploy/install.sh errai --commit COMMIT'
~/dev/personal/cria-run/ts/deploy/install.sh thuban --commit COMMIT
```

It fetches, checks out `COMMIT` detached (default `origin/main`), runs `pnpm install --frozen-lockfile --prod`, links the machine's units from `ts/deploy/` into `~/.config/systemd/user/` (`systemctl --user link`, so an installed unit is always the repo's file), reloads systemd and restarts the programs (`rig` on errai, the viewer on thuban; they hold no drivers, and a rig program restart only sends the mount's `TIME_UTC` again). On thuban it first creates or updates the stream (`src/bin/ensure-stream.ts`, from the viewer's settings file). It never restarts `indiserver` or `phd2` unless you add `--restart indiserver` or `--restart phd2`, it never enables `phd2`, and it never touches a settings file.

A first install is the same two lines after `git clone` of this repo to the path above. The firewall unit `phd2-guard` is a system unit installed once with sudo ([docs/phd2.md](docs/phd2.md)).

Configuration lives outside the repo: on errai `~/.config/cria/rig.json` (the rig file, whose `stream` section holds the broker login, `passFile` naming the file that holds the password, and the journal and PHD2 settings); on thuban `~/.config/rig-stream/viewer.json`. Each setting's description, with the evidence behind its default, is in `src/rig/config.ts`, `src/stream/config.ts`, `src/viewer/config.ts` and `src/stream/ensure.ts`. An unknown key or invalid value stops the program at start. The site coordinates live only in the rig file on errai, never in the repo.

`systemctl --user restart indiserver` restarts the rig software as one: `rig` is `PartOf` it and starts every driver again within a few polls. It also stops the camera cooler until the camera is connected again.

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
- `driver` names the executable the FIFO starts and restarts. indiserver starts with no drivers, so a device without one is never brought up. Settings that are not in the list of devices (poll interval, thresholds, backoff) are the other keys of `RigFile` in `src/rig/config.ts`, each with its description and default.
- `stream` (required) configures the recording: `broker` (`servers`, `user`, `passFile`, the path of a file holding only the password), and optionally `rig`, `journalExclusions`, `journalCursorFile` and `phd2`, described in `src/stream/config.ts`. The password is never in the rig file.

## How the rig comes up

The mini PC may boot before the rest of the rig has power, and nothing is started by hand. Every poll the rig program compares what INDI shows with the rig file and writes only what differs; nothing is a command with an outcome to track. A write that did not take is simply still different at the next poll, and repeats back off at 10 s, then 30 s, then 60 s.

- A device that is disconnected gets its `DEVICE_PORT` (serial devices), then `CONNECTION`, once its hardware has been present for two polls. A device that is connected gets the properties of its table that differ and its `onConnect` properties. A property its driver has not defined yet is not written yet: drivers define most of theirs only after the connection is on.
- indiserver starts with no drivers. A device that is missing from INDI while its hardware is present has its driver started through the FIFO (`stop`, then `start`; the stop of a driver that is not running does nothing), unless a property of any device that driver serves is Busy. That is also how a driver that died comes back. `indi_asi_ccd` and `indi_asi_focuser` define a device only if its USB device is present when the driver starts; `indi_lx200am5` and `indi_pegasus_ppba` always define theirs, so for them the serial path is the hardware. Both cameras are served by `indi_asi_ccd`. A restart is repeated at most once in 20 s and backs off at 10 s, 30 s and 60 s.
- A serial device whose driver reports `[ERROR]` messages without a break of 5 s for 30 s is a dead link, although the device still looks connected (11-01 and 11-02: the mount and the box drivers printed `Serial write error: Write Error: Input/output error` two to three times a second for hours). The rig program reconnects the device (`CONNECTION` off, then on). If it is not connected and quiet 60 s later, it restarts that device's driver. The device's own Busy properties do not hold the restart back: a dead mount keeps `TELESCOPE_TRACK_STATE` Busy.
- It never switches power, and none of the properties it writes starts a motion or an exposure. It logs one line per decision, without the values it writes.

Its writes reach the rig stream directly: the tap on its one INDI connection records every element it sends and receives.

## Changing a device by hand

On errai, `indi_setprop "ZWO EAF.CONNECTION.DISCONNECT=On"` writes any property. A property the rig file names is written back at the next poll, and a device the rig file wants connected is connected again: to keep a device off or set a different value, edit `~/.config/cria/rig.json` and `systemctl --user restart rig`.

## Ownership of the rig

Who owns the equipment is a live condition. Verify the current owner before the rig program runs against the rig. Agents do not command the real rig unless Chris is present, as [AGENTS.md](AGENTS.md) says.
