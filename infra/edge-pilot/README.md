# Event Edge pilot bundle

This bundle runs the venue-local Event Edge, its dedicated PostgreSQL database, and an HTTPS boundary for physical POS registers. Event Edge remains on the venue LAN; only its outbound Cloud API traffic crosses the WAN.

## Security boundary

- POS devices use their own per-device Edge credentials for device sync/payment routes.
- Physical POS traffic reaches Event Edge only through venue-local HTTPS.
- Caddy terminates LAN TLS with a private pilot CA. The CA private key stays in the local Docker volume; only the public root certificate is exported for POS trust.
- Raw Event Edge HTTP port `3002` is not published to the venue LAN.
- Android cleartext traffic is disabled. Dedicated pilot POS devices may trust the operator-installed Event Edge root CA in addition to system roots.
- `EDGE_CLOUD_SYNC_TOKEN` authenticates this Event Edge to Cloud.
- `EDGE_LOCAL_ADMIN_TOKEN` protects local inventory/configuration HTTP routes in production.
- PostgreSQL is not published to the venue LAN.
- Do not reuse any of these credentials across Edge machines.

The pilot Android trust model assumes dedicated/locked registers. Do not install unrelated user CAs on these devices. A later production hardening step can pin a managed Event Edge CA in the app or device-management policy.

## Prerequisites

- Docker Engine with Compose v2 (Docker Desktop is fine for a pilot laptop).
- A clone of this repository at the exact reviewed release commit.
- A stable venue-LAN IPv4 address for the Edge machine. Prefer a DHCP reservation or static lease.
- The synthetic pilot event schedule moved to the timestamps recorded in `.env` before bootstrap.
- A Cloud Edge identity provisioned for the `EDGE_ID` in `.env`.

## Prepare

1. Copy `.env.example` to `.env` in this directory.
2. Set `RELEASE_COMMIT` to the exact merged commit being installed.
3. Fill `EDGE_CLOUD_SYNC_TOKEN`, `EDGE_LOCAL_ADMIN_TOKEN`, and `EDGE_POSTGRES_PASSWORD` with independent strong random URL-safe secrets (at least 32 characters). Never commit `.env` or paste these values into chat.
4. Set `EDGE_LAN_HOST` to the Edge machine's stable venue-LAN IPv4 address, or use the Windows helper below to detect and write it.
5. Keep the default HTTPS port `8443` unless the venue network requires another port.

The checked-in pilot IDs are non-secret and intentionally point to the Event Commerce OS Pilot configuration. Do not reuse this `.env.example` unchanged for another organisation/event.

## Start Event Edge with venue-local HTTPS

On Windows, from the repository root, the preferred pilot setup is:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\edge-pilot\prepare-lan-https.ps1
```

If Windows has multiple active routed interfaces, select the venue address explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\edge-pilot\prepare-lan-https.ps1 -LanAddress 192.168.1.50
```

The helper:

1. writes only the non-secret LAN HTTPS settings to the existing `.env`;
2. starts/recreates the Compose services without deleting the PostgreSQL data volume;
3. waits for Caddy to create its internal CA;
4. exports only the public root certificate as `infra/edge-pilot/event-edge-root-ca.crt`;
5. validates the HTTPS health endpoint using that root; and
6. prints the exact POS sync endpoint and the public root certificate SHA-256 fingerprint.

The expected POS endpoint is shaped like:

```text
https://192.168.1.50:8443/sync/device-events
```

The Caddy private CA key is never copied out of its Docker data volume. Do not export or share private-key material.

For non-Windows/manual startup, set `EDGE_LAN_HOST` in `.env` and run from `infra/edge-pilot`:

```sh
docker compose --env-file .env -f compose.yml up -d --build
```

The migration container must exit successfully, `event-edge` must become healthy, and `edge-https` must remain running. PostgreSQL stays on the private Docker network. Event Edge's raw HTTP listener is Docker-internal; the venue-facing listener is HTTPS only.

Useful checks:

```sh
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=100 event-edge
docker compose --env-file .env -f compose.yml logs --tail=100 edge-https
```

## Trust the pilot CA on each Android register

Before provisioning a physical register:

1. transfer only `event-edge-root-ca.crt` to the dedicated POS device;
2. verify its SHA-256 fingerprint matches the value printed by `prepare-lan-https.ps1`;
3. install it as a user CA certificate on that dedicated device;
4. do not install unrelated user CAs on the register; and
5. keep the register and Edge machine on the same venue LAN.

The Android app still requires an `https://` endpoint and has cleartext disabled. Its network security configuration allows the dedicated pilot device to trust this operator-installed user CA. System-trusted HTTPS endpoints remain trusted as well.

## Install pilot inventory configuration and opening stock

Run the idempotent bootstrap inside the Event Edge container:

```sh
docker compose --env-file .env -f compose.yml exec -T event-edge node /pilot/bootstrap.mjs
```

The bootstrap:

1. verifies local Edge health;
2. installs the event inventory snapshot;
3. maps `Pilot Bar` to `Pilot Store`;
4. installs the packaged Pilot Water SKU with no recipe so a sale posts one direct `SALE` depletion;
5. grants the pilot operator local inventory permissions;
6. posts one idempotent `RECEIPT` opening movement (default 100 bottles); and
7. prints the local stock projection without printing any secret.

Re-running with unchanged inputs is safe. If a previously used idempotency key is supplied with different movement content, Event Edge fails closed rather than silently altering stock history.

## Run the one-sale Edge rehearsal

After bootstrap and before provisioning a physical Android register, a fresh pilot state may run one synthetic POS sale through the real POS-device authentication and device-sync boundary:

```sh
docker compose --env-file .env -f compose.yml exec -T event-edge node /pilot/rehearsal.mjs
```

The rehearsal deliberately fails closed unless the configured Pilot Water stock is still exactly the untouched opening quantity (default `100`). It then:

1. provisions an ephemeral POS device through the supported device-credential administration script;
2. submits one authenticated `ORDER_CLOSED_CASH` event through `/sync/device-events`;
3. verifies the Edge accepts the event;
4. verifies local inventory moves exactly once from `100` to `99`;
5. revokes the ephemeral POS credential immediately; and
6. prints only non-secret rehearsal evidence.

Do not rerun this one-sale rehearsal against the same bootstrap state after it passes. A second sale is not a valid way to test recovery. Use a fresh rehearsal event or an attributable inventory correction/count procedure rather than rewriting ledger history.

This synthetic smoke test does not replace physical Android-device, LAN, HTTPS, offline/reconnect or payment-provider evidence required by the controlled pilot runbook.

## Provision a physical Android register

The Android app displays a durable local register ID on its setup screen. Provision that exact ID on Event Edge with the supported device-management script, assigned to the pilot event and sales location. The generated credential is one-time sensitive material: put it only into that register's setup screen and do not reuse it on another device.

Enter the HTTPS sync endpoint printed by the LAN helper, for example:

```text
https://192.168.1.50:8443/sync/device-events
```

The same provisioned HTTPS authority is used by the POS payment transport, so sync and Edge payment calls remain on the same local TLS boundary.

## Cloud verification

After bootstrap or POS activity, allow the forwarders a few seconds to deliver their durable outboxes to `https://api-event.nairobuy.com`. Verify through the authenticated Control/Cloud path (or controlled database inspection) that:

- the Edge credential authenticated;
- the configuration event arrived;
- opening stock appears in the Cloud inventory projection;
- the order/device state arrives after a POS sale;
- Cloud inventory converges to the same quantity as Edge; and
- no reconciliation exception was created.

Do not seed Cloud inventory tables directly. Event Edge is the source of operational inventory ledger events.

## Offline/WAN expectation

POS-to-Edge traffic is venue-local and does not depend on the WAN. If Cloud connectivity drops, Event Edge keeps durable local outboxes and the sales path remains local. When WAN connectivity returns, Event Edge forwards the queued Cloud sync and inventory events with idempotent/reconciliation safeguards.

The private CA and leaf certificates are also local; existing POS-to-Edge HTTPS does not depend on an external certificate authority being reachable during the event.

## Pilot limitations

This bundle is suitable for controlled functional venue rehearsal, not a 20,000-attendee capacity certification. Before a large live event, run production-like device concurrency, WAN outage/recovery, reconnect-storm, payment callback, certificate lifecycle, hardware/network and device-management rehearsals.
