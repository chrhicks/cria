# Architecture

```
drivers -> indiserver -> Cria -> rig stream (NATS on thuban) -> clients
                           ^
                      rig-supervisor
```

- **Drivers and `indiserver`** own the equipment. One process per driver; `indiserver -r 0` does not restart a crashed one.
- **Cria** (`ts/apps/cria`) is an INDI client. It sends nothing on its own. It publishes every `new*Vector` it sends to the rig stream, and on `POST /connect` it connects or disconnects one configured device and sets it up. See [SPEC.md](ts/SPEC.md).
- **The rig stream client** (`ts/apps/rig-stream`) publishes the raw INDI traffic, the system journal and PHD2 to the stream. The viewer in the same package shows it.
- **The rig supervisor** (`ts/deploy/rig-supervisor.mjs`) is outside Cria. It restarts a driver whose device is missing while its hardware is present, and asks Cria to connect devices. See [runtime.md](runtime.md#the-rig-supervisor).
- **Clients** read the rig from the stream. The one thing they ask Cria for is a device connection.

Packages in `ts/packages`: `indi` (client, mirror, XML, tap), `stream` (entry format, subjects, publisher), `cria-wire` (health and connect schemas, committed `dist/`), `fake-indi` (test server).
