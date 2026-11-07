# Cria

Cria is TypeScript on Node 26 that runs the rig's software on errai (the rig PC, Intel N150, Arch) and the tools that read it on thuban. Node runs the `.ts` files directly; there is no build.

## What runs where

| Program | Where | What it does |
| --- | --- | --- |
| `indiserver` | errai | Owns the drivers, one process each, and listens on 7624. `-r 0`: it never restarts a crashed driver |
| `cria` | errai | An INDI client. Publishes every `new*Vector` it sends to the rig stream, and on `POST /connect` connects or disconnects one configured device and sets it up |
| `rig-supervisor` | errai | Restarts a driver whose device is missing while its hardware is present and nothing it serves is Busy, and asks Cria to connect devices |
| `rig-stream-client` | errai | Publishes the raw INDI traffic, the system journal and PHD2's events to the rig stream (NATS JetStream on thuban) |
| `rig-stream-viewer` | thuban | A web page of the stream |
| `phd2` | errai | Guiding, headless; see [docs/phd2.md](docs/phd2.md) |

Entry points are `ts/src/bin/{cria,rig,recorder,viewer}.ts`; each unit in `ts/deploy/` runs one.

## Layout (`ts/`)

| Folder | Contents |
| --- | --- |
| `src/indi` | INDI client, property mirror, XML, problem log, traffic tap ([README](ts/src/indi/README.md)) |
| `src/stream` | Entry format, subjects, publisher, broker login |
| `src/connect` | Cria's HTTP service: config, device-connect, `/health` and `/connect`, its stream entries |
| `src/rig` | The supervisor |
| `src/recorder` | The rig stream client: journal, PHD2, INDI wire |
| `src/viewer` | The stream viewer and its page |
| `deploy` | systemd units, `indi-ready.sh`, PHD2 profile and step scripts |
| `testing` | The real-`indiserver` harness, the fake INDI server, the golden of the wire, PHD2 script tests |

## Test

You need Node 26, pnpm and libindi with `indiserver` and `indi_simulator_focus`.

```sh
cd ts
pnpm install
./verify.sh
```

`verify.sh` runs the typecheck (which covers every test file) and every test, and exits with the failing stage's exit code. Read that code itself; never pipe the script. No test touches hardware. `pnpm golden:update` rewrites the HTTP wire golden, only for a reviewed wire change.

## Deploy

errai keeps its checkout at `~/dev/personal/cria-ts`; the units are templates that point there.

```sh
cd ~/dev/personal/cria-ts && git pull
cd ts && pnpm install --frozen-lockfile --prod
mkdir -p ~/.config/systemd/user
cp deploy/{cria,rig-supervisor,rig-stream-client,indiserver,phd2}.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart cria rig-supervisor rig-stream-client
```

Configuration lives outside the repo on errai: `~/.config/cria/rig.json` (Cria), `~/.config/cria/supervisor.json` (supervisor) and `~/.config/rig-stream/client.json` (recorder). Each setting's description is in `src/connect/config.ts`, `src/rig/config.ts` and `src/recorder/config.ts`. An unknown key or invalid value stops the program at start. The supervisor's device list names a USB `vid:pid` or a serial path per device, and a `driver` only with `usb`.

thuban's viewer runs from its own checkout so development never changes it:

```sh
git clone "$(git -C ~/dev/personal/cria remote get-url origin)" ~/dev/personal/cria-run
cd ~/dev/personal/cria-run/ts && pnpm install --frozen-lockfile --prod
cp deploy/rig-stream-viewer.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart rig-stream-viewer
```

`systemctl --user restart indiserver` restarts the rig software as one: `cria` and `rig-supervisor` are `PartOf` it, and `indi-ready.sh` holds the start until the drivers are up. It also stops the camera cooler until the camera is connected again.

## How the rig comes up

The mini PC may boot before the rest of the rig has power, and nothing is started by hand. `indi_lx200am5` and `indi_pegasus_ppba` always define their device, so the supervisor sends `POST /connect` once the serial port exists. `indi_asi_ccd` and `indi_asi_focuser` define a device only if its USB device is present when the driver starts, so the supervisor restarts that driver, then connects the device. A device that is connected but not set up in this Cria instance (after a Cria restart) gets the same request within two polls. A picture must hold for two polls before the supervisor acts. Repeats back off at 20 s, then 30 s, then 60 s. It never switches power, and it logs one line per decision.

## Cria's HTTP service

`GET /health` answers `{status: 'ok', protocolVersion: 6, instanceId}`; `instanceId` changes at every start. `POST /connect {deviceId, connected}` answers when device-connect is done: `200 {outcome: 'confirmed' | 'failed' | 'uncertain', message?, setup?}`, `404` for an unconfigured device, `400` for a bad body. Device-connect, in order: the INDI device must define `CONNECTION`; on connect, write `DEVICE_PORT` when configured; write `CONNECTION` and wait for it to settle; then the setup steps (camera `UPLOAD_MODE`, mount `GEOGRAPHIC_COORD` and `TIME_UTC`, `DEBUG` where `driverDebug` is set), each skipped when the driver does not define it. A write ends when its property shows the value, `Alert` (`failed`) or the timeout or a lost connection (`uncertain`). Nothing is resent.

Cria publishes `rig-dev.cria.write` for every `new*Vector` it sends, and `rig-dev.cria.request` and `rig-dev.cria.settled` around each connect. Without `streamClientConfig`, or when its file cannot be read, it runs and publishes nothing.

## Ownership of the rig

Who owns the equipment is a live condition. Verify the current owner before you connect Cria to the rig. Agents do not command the real rig unless Chris is present, as [AGENTS.md](AGENTS.md) says.
