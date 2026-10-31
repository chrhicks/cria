# Vela and Cria architecture

This page explains how the work splits between Vela and Cria. Vela's AGENTS.md is the product authority. [SPEC.md](ts/SPEC.md) is the contract, and the wire is the Effect Schema package `ts/packages/cria-wire` (`@cria/wire`). [Runtime](runtime.md) covers how Cria runs on errai.

## Where Cria fits

Vela's server talks to each rig through one adapter, chosen when the rig is composed:

- **Alpaca.** Vela talks directly to an Alpaca server, for example a Seestar.
- **Cria.** Vela talks HTTP and SSE to Cria on the rig PC, for example the FRA 400 rig.

```
Browser → Vela server ──HTTP/SSE (protocol 5)──▶ Cria ──INDI over TCP 7624──▶ indiserver ──▶ one process per driver ──▶ devices
```

The browser renders what the Vela server projects, including which actions are available. The Cria token stays in Vela's server. Cria refuses any request that carries an `Origin` header, so a browser cannot call it.

Vela's client still speaks protocol 4, the wire of the legacy .NET Cria. Protocol 5 has no compatibility layer, so Vela cannot drive the TypeScript Cria until [the Vela migration checklist](ts/vela-migration.md) lands.

## Who owns what

Moving Cria from .NET on Windows to TypeScript on Linux did not change the split.

| Cria owns | Vela owns |
| --- | --- |
| Current device state, as readings that are fresh, stale or unavailable | Runs and workflows, in Vela server memory |
| One bounded operation at a time per failure domain: one exposure, one focuser move, one slew | Decisions: what to do next, retries, when to stop |
| Request-ID dedupe, cancellation, and holding a mount after an uncertain outcome | Image processing, previews, plate solving, FITS |
| A rolling set of the newest captured images, until they are dropped | The archive of saved images |

Cria never decides what a run does next. Vela never talks to a driver directly on a Cria rig.

A failure domain is one INDI device. Most devices are their own domain. The Pegasus power box is one INDI device that Cria shows as two devices, weather and switch, so those two share a domain.

## What changed on Linux

INDI already runs each driver as its own process, so Cria runs no worker processes of its own. A driver crash shows up as the driver's properties disappearing, and Cria reports the device unavailable. INDI pushes property changes, so readings stay fresh while a camera exposes.

Cria now decides freshness once, as of each snapshot, and Vela reads `fresh`, `stale` or `unavailable` instead of deriving freshness from read times. Vela and Cria import the same `@cria/wire` package, so they agree on the wire by construction. [SPEC.md, "Changed from protocol 4"](ts/SPEC.md#changed-from-protocol-4) lists every wire change.

## The layers of the service

Each layer imports only from the layers below it in this diagram. The INDI boundary and the wire boundary map to no primitive on purpose. The INDI boundary absorbs INDI's irregularities, and the wire boundary holds the HTTP details, so the layers between them see neither.

```
wire boundary    apps/cria/src/wire          HTTP routes, SSE, projection into protocol 5 (@cria/wire)
workflows, Run   apps/cria/src/operation     the ledger, one Run per failure domain
capabilities     apps/cria/src/capability    camera, mount, focuser, weather, power, connection
disciplines      @cria/primitives            writeOnce, confirm, stoppable, retryReads, quarantineOf
types            @cria/primitives            Outcome, Reading
INDI boundary    @cria/indi                  XML framing, the TCP connection, the property mirror
```

`apps/cria/src/rig.ts` builds all of it from the configuration, with dependencies passed as plain arguments. The image store (`apps/cria/src/image`) converts FITS to ImageBytes and keeps the rolling set.

For the details, read these sections of SPEC.md:

- [The layers](ts/SPEC.md#the-layers) and [the module map](ts/SPEC.md#module-map), for what each file is.
- [Primitives](ts/SPEC.md#primitives), for Outcome, Reading, the disciplines, Run and Quarantine.
- [The ledger](ts/SPEC.md#the-ledger), for admission, halts, cancel and recovery.
- [The INDI boundary](ts/SPEC.md#the-indi-boundary), for which INDI property backs each reading.
- [The wire (protocol 5)](ts/SPEC.md#the-wire-protocol-5), for endpoints, errors and shapes.

## Unknown outcomes

If Cria cannot tell whether a command took effect, the operation ends `uncertain`. A mount's failure domain is then held until a person recovers it; any other device stays usable, and Vela shows a warning. Neither Cria nor Vela resends the command. A stop or abort is the one exception. Cria may send it again until the device confirms it is stationary, because an abort can only stop motion. A motion or a setting is never sent again.

Vela stops the run and tells Chris. A person checks the equipment before the device is cleared with `POST /v2/devices/{id}/recover`, which also gives the domain a new `bindingId`.

## Restarts

Runs are ephemeral. A new Cria instance has a new `instanceId`, an empty operation table and an empty image folder, so anything in flight before it is unknown. Vela reports the affected run as interrupted. It does not resume the run or resend commands. A restarted Vela server also starts fresh and does not rebuild runs from Cria. There is no durable session, journal, custody or receipt protocol between the two.

The INDI drivers keep running across a Cria restart and keep their state. [SPEC.md, "Restarts and crashes"](ts/SPEC.md#restarts-and-crashes) covers a Cria restart, a driver crash, `indiserver` going away and SIGTERM.
