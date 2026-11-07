# Cria: the contract

Cria is a Node service on errai, the rig PC. It connects to `indiserver` as an INDI client, publishes what it sends to the rig stream, and connects or disconnects one configured device when asked. Clients read the rig from the rig stream (NATS JetStream on thuban), not from Cria.

## What it does

1. **INDI connection.** `@cria/indi` is one TCP connection to `indiserver` (`127.0.0.1:7624` by default) with a mirror of every device's properties.
2. **Stream connection.** `apps/cria/src/stream.ts` publishes to the broker through `@cria/stream`.
3. **device-connect.** `apps/cria/src/connect.ts` connects or disconnects one device and sets it up.
4. **HTTP.** `GET /health` and `POST /connect`.

## The INDI boundary

`@cria/indi` gives one `IndiDevice` per INDI device name: `property(name)` (kind, state `Idle|Ok|Busy|Alert`, permission, elements, `receivedAt`), a stream of changes, `subscribe`, `send(name, values)` (one `new*Vector`, never retried) and a one-off `read`. XML and sockets stay inside the package.

On connect it sends `getProperties version="1.7"`. Reconnect is paced, 250 ms doubling to 5 s, and resets after 10 s connected. A lost connection fails every pending `send` as `connection-lost`. An element it cannot read is skipped and logged, and only lost framing drops the connection ([indi-bad-input.md](indi-bad-input.md)). `delProperty` without a name clears the device.

## The stream

With `streamClientConfig` set, Cria publishes through `@cria/stream` and logs in with the password from its own file. Without it, or when the file cannot be read, Cria runs and publishes nothing.

| Subject | Kind | When |
|---|---|---|
| `rig-dev.client` | `client.connected` | each time the broker connection is made: `{client: 'cria', run, connection, sources}` |
| `rig-dev.cria.write` | `cria.write` | every `new*Vector` Cria sends: `{device, property, conn, xml}` |
| `rig-dev.cria.request` | `cria.request` | one per `POST /connect` for a configured device: `{deviceId, kind: 'device-connect', connected, result: 'accepted'}` |
| `rig-dev.cria.settled` | `cria.settled` | its end: `{deviceId, kind: 'device-connect', connected, outcome: {kind, message?, setup?}}` |

## device-connect

For the configured device, in order:

1. The INDI device must define `CONNECTION`, else `failed`.
2. On connect, when the config names a `port` and `DEVICE_PORT` shows another one, write `DEVICE_PORT` and wait for it to show the port.
3. When `CONNECTION` does not already show the wanted state, write it and wait for the mirror to show it settled (not `Busy`), within `connectTimeoutMs`.
4. On connect, the setup steps, each within `confirmMs`:
   - camera: `UPLOAD_MODE` to `UPLOAD_CLIENT`;
   - mount with a `site`: `GEOGRAPHIC_COORD` (longitude as INDI's 0 to 360 east);
   - mount: `TIME_UTC` set to now;
   - any device with `driverDebug`: `DEBUG` `ENABLE`, then `DEBUG_LEVEL` `DBG_DEBUG`.

A property the driver has not defined is skipped and named in `setup` (`UPLOAD_MODE skipped: not defined`). A property that already shows the value is not written (`already set`). A write ends when its property shows the value, `Alert` (`failed`, with the driver's message), the device or indiserver connection going away or the timeout (`uncertain`). Nothing is resent. The first failing step ends the call, and later steps are not tried.

## HTTP (protocol 6)

`GET /health` answers `200 {status: 'ok', protocolVersion: 6, instanceId}`. `instanceId` changes at every Cria start.

`POST /connect` takes `{deviceId, connected}` (no other key) and answers when device-connect is done:

- `200 {outcome: 'confirmed' | 'failed' | 'uncertain', message?, setup?}`; `setup` is the setup summary on a connect;
- `404` for a device that is not configured;
- `400` for a body that is not JSON or not that shape.

Every other request answers `404`. Error bodies are `{message}`. The schemas are in `@cria/wire`, which ships its `dist/`.

## Configuration

One JSON file, the first argument (or `CRIA_CONFIG`). An unknown key or invalid value stops the process at start. Each setting's description is in `apps/cria/src/config.ts`.

| Key | Default |
|---|---|
| `listen` `{host, port}` | `127.0.0.1:4319` |
| `indi` `{host, port}` | `127.0.0.1:7624` |
| `devices` (1 to 16) | required |
| `connectTimeoutMs` | 120000 |
| `confirmMs` | 15000 |
| `streamClientConfig` | absent: no publishing |

A device is `{id, kind, indiDevice, port?, site?, driverDebug?}`, with `kind` one of `camera`, `mount`, `focuser`, `box` and `site` for a mount only.

## Restarts

Cria keeps nothing. A restart is a new `instanceId`. The drivers keep their state. When `indiserver` or a driver goes away, Cria reconnects and writes nothing by itself: a device is connected and set up only when `POST /connect` asks, and on the rig the supervisor asks ([runtime.md](../runtime.md#the-rig-supervisor)).

## Tests

`ts/verify.sh` runs build, typecheck, the committed `dist/` check and the tests, which include the golden of the wire in `ts/testing/golden`. Tests run against `@cria/fake-indi`. Nothing touches equipment.
