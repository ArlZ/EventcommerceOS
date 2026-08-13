# Execution Plan 003 — Locally Durable POS Order Core

## Goal

Build the first real Android POS sale flow so the device can use cached configuration, lose all network connectivity, create and close local cash-test orders, restart repeatedly, and retain every acknowledged order.

## Locked decisions

### Local authority

- Room/SQLite is authoritative for unsynced device activity.
- UI success is shown only after the Room transaction returns successfully.
- Cloud, Event Edge, analytics and telemetry are not part of the synchronous sale path.
- Failed local transactions are surfaced as failures rather than optimistic success.

### Orders and money

- Order IDs and local event IDs are generated on-device before persistence.
- Money is integer minor units plus currency; overflow is checked.
- The local cash-development path uses documented `OPEN -> PAID -> CLOSED` transitions in one database transaction.
- Order items persist sell-time menu item, SKU, name, unit price, quantity and line total so later menu changes do not rewrite closed history.
- Closed orders have no normal POS mutation path.

### Transactional outbox

- Relevant order state and an outbox record are committed in the same Room transaction.
- Outbox records carry a stable instance ID, aggregate identity, event type/version, device ID, monotonic per-device sequence, timestamp and idempotency key.
- Task 003 persists a compact order-state payload. Network delivery, receiver replay semantics and any richer synchronization envelope are Task 004 work.

### Menu cache

- Menu configuration is versioned and locally persisted.
- Candidates include event/menu identity, version, activation time, source actor, currency, item data and a deterministic CRC32 checksum over canonical content.
- CRC32 is used for accidental-corruption detection only, not peer authenticity.
- Validation occurs before active configuration changes.
- Invalid checksum, invalid version/data, malformed money, empty menus or duplicate item/SKU identities are rejected while the last valid menu remains active.
- A deterministic development menu is seeded only when no active menu exists so the offline acceptance test needs no server.

### Concurrency and restart behavior

- Order mutations are serialized by a process-local mutex and Room transactions.
- SQLite serializes persisted menu/order writes.
- Repeated cash close on an already-closed order returns the existing order and emits no second close event.
- The current open order and history are always reconstructed from SQLite after startup.

### UX

- Compose uses large product targets, categories, favourites-ready metadata, visible current order/total, fast quantity controls, one cash-close action, clear-order confirmation and local history.
- Normal checkout requires no typing.
- The screen clearly communicates offline-local operation and pending local events.

## Local schema

Task 003 adds versioned menu tables, cached menu items, orders, order items and durable pending-event/outbox rows while retaining local metadata for device identity and sequence. Database version 2 uses an explicit migration from the Task 001 schema; destructive migration is not allowed.

## Failure-mode tests

Automated Android tests must cover:

1. 100 cash-test orders with no network dependency;
2. database close/reopen several times during that 100-order run;
3. committed open/closed orders and pending events surviving reopen;
4. failure before commit rolling back order state and pending events together;
5. repeated close remaining idempotent;
6. invalid menu update retaining the last valid menu;
7. monotonic, non-duplicated device event sequence numbers.

The existing PostgreSQL/TypeScript regression gate must remain green, together with Android `testDebugUnitTest` and `lintDebug`.

## Non-goals

Task 003 does not add electronic payment providers, network synchronization, Event Edge order ingestion, cloud order persistence, inventory depletion, refunds/comps, production authentication, receipt printing or final visual design.

## Completion criteria

Task 003 is complete when the POS can operate using only cached SQLite data, acknowledge state only after durable commit, recover after repeated database/app restarts, protect cash close from duplicate submission, retain valid configuration after a bad update, preserve a same-transaction local outbox and pass the full repository CI gate.
