# Event Edge pilot bundle

This bundle runs the venue-local Event Edge and its dedicated PostgreSQL database. Event Edge remains on the venue LAN; only its outbound Cloud API traffic crosses the WAN.

## Security boundary

- POS devices use their own per-device Edge credentials for device sync/payment routes.
- `EDGE_CLOUD_SYNC_TOKEN` authenticates this Event Edge to Cloud.
- `EDGE_LOCAL_ADMIN_TOKEN` protects local inventory/configuration HTTP routes in production.
- PostgreSQL is not published to the venue LAN.
- Do not reuse any of these credentials across Edge machines.

## Prerequisites

- Docker Engine with Compose v2 (Docker Desktop is fine for a pilot laptop).
- A clone of this repository at the exact reviewed release commit.
- The synthetic pilot event schedule moved to the timestamps recorded in `.env` before bootstrap.
- A Cloud Edge identity provisioned for the `EDGE_ID` in `.env`.

## Prepare

1. Copy `.env.example` to `.env` in this directory.
2. Set `RELEASE_COMMIT` to the exact merged commit being installed.
3. Fill `EDGE_CLOUD_SYNC_TOKEN`, `EDGE_LOCAL_ADMIN_TOKEN`, and `EDGE_POSTGRES_PASSWORD` with independent strong random URL-safe secrets (at least 32 characters). Never commit `.env` or paste these values into chat.
4. If the venue host port or bind address differs, update `EDGE_PORT` / `EDGE_BIND_ADDRESS`.

The checked-in pilot IDs are non-secret and intentionally point to the Event Commerce OS Pilot configuration. Do not reuse this `.env.example` unchanged for another organisation/event.

## Start Event Edge

From `infra/edge-pilot`:

```sh
docker compose --env-file .env -f compose.yml up -d --build
```

The migration container must exit successfully and `event-edge` must become healthy. PostgreSQL stays on the private Docker network; Event Edge is exposed on the configured LAN port (default `3002`).

Useful checks:

```sh
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=100 event-edge
```

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
6. posts one idempotent `RECEIPT` opening movement (default 100 bottles);
7. prints the local stock projection without printing any secret.

Re-running with unchanged inputs is safe. If a previously used idempotency key is supplied with different movement content, Event Edge fails closed rather than silently altering stock history.

## Run the one-sale Edge rehearsal

After bootstrap and before provisioning a physical Android register, run one synthetic POS sale through the real POS-device authentication and device-sync boundary:

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

Do not rerun this one-sale rehearsal against the same bootstrap state after it passes. A second run is expected to stop before creating another sale because stock is no longer the untouched opening quantity. Use a fresh rehearsal event or an attributable inventory correction/count procedure rather than rewriting ledger history.

This local smoke test does not replace the supported Android-device, LAN, HTTPS, offline/reconnect or payment-provider evidence required by the controlled pilot runbook.

## Cloud verification

After bootstrap or the one-sale rehearsal, allow the forwarders a few seconds to deliver their outboxes to `https://api-event.nairobuy.com`. Verify through the authenticated Control/Cloud path (or controlled database inspection) that:

- the Edge credential authenticated;
- the configuration event arrived;
- opening stock appears in the Cloud inventory projection;
- after the one-sale rehearsal, the order/device state arrives and Cloud stock converges to `99`;
- no reconciliation exception was created.

Do not seed Cloud inventory tables directly. Event Edge is the source of operational inventory ledger events.

## Pilot limitations

This bundle is suitable for functional venue rehearsal, not a 20,000-attendee capacity certification. Before a large live event, run production-like device concurrency, WAN outage/recovery, reconnect-storm, payment callback, and hardware/network rehearsals.
