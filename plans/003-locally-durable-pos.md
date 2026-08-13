# Execution Plan 003 — Locally Durable POS Order Core

## Goal

Implement the first real Android POS sale-building slice so a device can use a cached versioned menu, lose all network connectivity, create and close cash test orders durably in Room/SQLite, restart, and retain every acknowledged order.

## Locked implementation decisions

### Local authority and acknowledgement

- Room/SQLite is authoritative for unsynced device-created order state.
- Every user-visible successful order mutation is rendered only after the corresponding Room transaction completes.
- No cloud, Event Edge, analytics, telemetry or network call is allowed on the synchronous item-selection or cash-close path.
- Local failures surface as failures; the UI must never optimistically acknowledge a mutation that did not commit.

### Order aggregate

- Order IDs and outbox event IDs are UUIDs generated locally before persistence.
- Device sequence numbers are monotonically incremented in SQLite and allocated inside the same transaction as the domain mutation that emits an outbox event.
- Task 003 uses `OPEN`, `PAID`, `CLOSED`, and `VOIDED` from the documented order state machine. A persisted sale starts as `OPEN`; cash checkout transitions it through `PAID` to `CLOSED` atomically for this development-only payment path.
- Order totals are integer minor units with an explicit currency code. No floating-point money exists in the POS data model.
- Order items store the sell-time snapshot of menu item identity, SKU identity, display name, unit price, quantity and line total so later menu changes cannot rewrite history.
- Closed orders and their items are immutable in normal POS operations.

### Transactional outbox

- Every relevant order mutation writes domain state and an outbox row in one Room transaction.
- Outbox rows contain a stable event instance ID, aggregate ID/type, event type/version, device ID, per-device sequence, occurred-at UTC timestamp, idempotency key and a compact JSON payload.
- Task 003 only persists the outbox. Network delivery and replay handling belong to Task 004.

### Menu cache

- POS menu configuration is versioned and stored locally.
- A menu candidate contains version, activation time, source actor, currency, item data and a SHA-256 checksum over a deterministic canonical representation.
- A candidate is fully validated before any active-menu state is changed.
- Invalid checksum, malformed money, duplicate item IDs/SKU IDs, empty menu, invalid version or invalid item data rejects the update and leaves the last valid active menu untouched.
- A deterministic built-in development menu is seeded only when no valid active menu exists, allowing the Task 003 acceptance flow to run with all network services stopped.

### Concurrency and double-submit protection

- Repository mutations are serialized with a process-local mutex and enforced again through Room transactions/state checks.
- Cash close is idempotent for an already-closed order: repeated taps return the same closed order and do not emit another cash-close outbox event.
- Item mutations reject closed/non-open orders.

### Restart recovery

- The current open order is derived from SQLite at startup.
- Local transaction history reads closed orders from SQLite.
- No in-memory-only sale state is considered authoritative.

### UI

- Compose POS screen uses large product targets, category filters, favourites-ready item metadata, always-visible current order and total, fast quantity controls, one clear cash-close action, clear-order guardrail, and local transaction history.
- Normal checkout requires no keyboard input.
- The UI visibly states that the development cash path is local-only and that ordering remains available without network connectivity.

## Room schema

Task 003 adds local tables for:

- menu versions;
- cached menu items;
- orders;
- order items;
- outbox events;
- device counters/identity metadata.

Database version increases with an explicit migration from the Task 001 metadata-only schema. Destructive migration is not permitted.

## Test strategy

### Pure/unit tests

- integer-money/order total rules;
- order state transition rules;
- deterministic menu checksum;
- invalid menu candidate rejection;
- duplicate tap/cash-close idempotency rules where testable without Android runtime.

### Room/JVM integration tests

Use Robolectric with an in-memory Room database to cover:

- local order/item mutation and outbox atomicity;
- close and restore order history;
- repeated cash-close does not duplicate the close event;
- transaction rollback does not acknowledge/persist partial state;
- last valid menu remains active after corrupt update;
- 100 offline cash orders persist with the expected closed-order and outbox counts.

### Existing regression gate

Task 001 and Task 002 TypeScript/PostgreSQL checks remain green. Android `testDebugUnitTest` and `lintDebug` must pass.

## Failure-mode acceptance

Automated coverage must demonstrate:

1. order creation works without any network dependency;
2. a committed order/outbox survives repository/database re-open;
3. a failed transaction leaves no partial acknowledged order;
4. repeated close requests are idempotent;
5. open and closed local orders restore after restart;
6. corrupt menu updates do not replace the last valid menu;
7. 100 local cash orders can be created and closed using only SQLite.

## Non-goals

- M-PESA, card or provider SDKs;
- network sync/outbox delivery;
- Event Edge ingestion;
- cloud order persistence;
- inventory depletion or stock ledger entries;
- refunds, comps, void approval or supervisor authorization;
- production authentication;
- receipt printer integration;
- final POS visual design.

## Completion criteria

Task 003 is complete only when the POS can operate from cached local configuration with cloud and edge absent, acknowledge mutations only after durable SQLite commits, recover open/closed orders after database re-open, protect against repeated close submission, retain the last valid menu after an invalid update, and pass the full existing CI gate.