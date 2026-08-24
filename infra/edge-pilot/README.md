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
4. installs the Pilot Water SKU and one-to-one depletion recipe;
5. grants the pilot operator local inventory permissions;
6. posts one idempotent `RECEIPT` opening movement (default 100 bottles);
7. prints the local stock projection without printing any secret.

Re-running with unchanged inputs is safe. If a previously used idempotency key is supplied with different movement content, Event Edge fails closed rather than silently altering stock history.

## Cloud verification

After bootstrap, allow the inventory forwarder a few seconds to deliver its outbox to `https://api-event.nairobuy.com`. Verify through the authenticated Control/Cloud path (or controlled database inspection) that:

- the Edge credential authenticated;
- the configuration event arrived;
- opening stock appears in the Cloud inventory projection;
- no reconciliation exception was created.

Do not seed Cloud inventory tables directly. Event Edge is the source of operational inventory ledger events.

## Pilot limitations

This bundle is suitable for functional venue rehearsal, not a 20,000-attendee capacity certification. Before a large live event, run production-like device concurrency, WAN outage/recovery, reconnect-storm, payment callback, and hardware/network rehearsals.
