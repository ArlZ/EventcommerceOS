# Execution Plan 005 — Inventory Ledger, Alerts & Replenishment

## Goal

Build event inventory as an append-only, replay-safe operational engine that remains useful at Event Edge during cloud outages, consolidates to Cloud, and gives inventory operators actionable low-stock and replenishment workflows without introducing any network dependency into the POS sale path.

## Non-negotiable invariants

1. Stock-on-hand is derived from immutable ledger entries; no mutable balance is authoritative.
2. Inventory quantities use integer base units (`each`, `ml`, `g`, etc.). Recipe ratios are represented as integer base-unit consumption per sold unit; no floating-point inventory arithmetic.
3. Every externally retryable inventory mutation has an idempotency key and one durable business effect.
4. Corrections use reversal/adjustment ledger entries; inventory history is never hard-deleted or overwritten.
5. Every privileged movement/transfer/count/alert transition records actor, timestamp, event/location context and reason where required.
6. Sale-driven depletion consumes immutable order-line snapshots. Order totals alone never infer stock usage.
7. Event Edge owns live event-local inventory coordination while Cloud is disconnected. Cloud receives/consolidates replay-safe inventory history for Control Web and organisation-wide reporting.
8. Alerts/notifications run after the inventory transaction. Notification failure cannot roll back a sale or ledger movement.

## Vertical slices

### 1. Pure inventory domain rules

Add framework-independent rules under `packages/domain` for:
- movement signs/types;
- transfer and alert state machines;
- recipe quantity conversion;
- rolling-window velocity and minutes of cover;
- projected demand/stockout;
- replenishment quantity bounded by source safety stock/in-transit stock;
- deterministic severity decisions.

All arithmetic uses integers; rate/cover calculations may use rational/numeric calculation internally but ledger quantities remain integers and recommendations round conservatively.

### 2. Immutable sale line snapshots

Extend POS order outbox payloads so order events include immutable line snapshots containing at minimum SKU ID, quantity and unit price metadata. The line snapshot is written inside the same Room transaction as the order mutation/outbox event.

`ORDER_CLOSED_CASH` becomes a sufficient replay-safe input for inventory sale/recipe consumption without querying mutable order state later.

### 3. Event Edge inventory engine

Add Edge PostgreSQL schema for:
- inventory configuration and sales-location → inventory-location mapping;
- recipes/components;
- append-only stock ledger;
- processed inventory source events/idempotency;
- transfers + transfer lines + transition history;
- stock counts + count lines;
- alert configuration, alerts, assignments/escalation metadata;
- notification outbox/delivery status.

Edge inventory service must:
- post receipt/wastage/breakage/comp/count-adjustment/reversal movements transactionally;
- consume closed-order sync events idempotently into `SALE` or `RECIPE_CONSUMPTION` ledger rows;
- derive stock projection with SQL aggregation over ledger entries;
- preserve negative-stock visibility rather than silently clamping balances;
- evaluate affected alert/replenishment state after committed movements.

### 4. Transfers & counts

Transfer lifecycle:

`REQUESTED -> ASSIGNED -> PICKING -> IN_TRANSIT -> RECEIVED`

Allow cancellation only before stock is in transit unless an explicit compensating return/correction workflow is used. Dispatch/in-transit creates `TRANSFER_OUT`; receipts create `TRANSFER_IN`. Partial receipt records received quantity per line and leaves the transfer partially outstanding until all lines are received or explicitly closed/cancelled under policy.

Physical count close computes variance against ledger projection and appends `COUNT_ADJUSTMENT`; it never replaces history.

### 5. Alerts & replenishment

Configurable per event/location/SKU:
- absolute low-stock threshold;
- minutes-of-cover threshold;
- projected stockout before event end;
- event-wide shortage threshold/safety stock;
- stock-imbalance detection;
- target cover and source safety stock.

Velocity uses deterministic short/medium rolling windows from sale/recipe-consumption ledger timestamps, with explicit zero/near-zero behavior and spike tests.

Recommendations consider destination available stock, target cover, stock already inbound, candidate-source surplus and minimum source safety stock. Recommendations never auto-dispatch.

Alert lifecycle:

`OPEN -> ACKNOWLEDGED -> ASSIGNED -> RESOLVED`

In-app notification rows are durable. External SMS/WhatsApp are adapter contracts/stubs only in Task 005.

### 6. Cloud consolidation & Control Web

Cloud consumes inventory movement/transfer/alert events idempotently and exposes an inventory operations read API. Control Web shows critical alerts first with:
- location/SKU;
- on-hand/available/in-transit;
- minutes of cover;
- projected stockout;
- warehouse/source surplus;
- suggested transfer quantity;
- current transfer/alert state.

Cloud/dashboard freshness never affects Edge/POS inventory transactions.

## Failure-mode tests

Automate at minimum:
1. duplicate closed-sale event -> one inventory depletion;
2. concurrent sale and transfer ledger writes preserve every movement;
3. recipe conversion precision in integer base units;
4. count close creates adjustment while preserving prior history;
5. partial receipt and eventual full receipt;
6. unresolved/invalid transfer transitions are rejected without ledger corruption;
7. location stockout risk while event-wide stock remains healthy;
8. event-wide projected shortage;
9. zero velocity and burst/spike velocity behavior;
10. replenishment never reduces a source below safety stock and accounts for inbound stock;
11. notification-delivery failure leaves ledger/alert transaction intact;
12. alert acknowledgement, assignment, escalation and resolution state;
13. Edge restart/replay leaves stock unchanged for already-processed sale events;
14. Cloud replay of inventory events produces one consolidated business effect.

## Non-goals

- payments/M-PESA/card work;
- supplier procurement automation;
- AI demand forecasting;
- automatic stock dispatch;
- SMS/WhatsApp provider credentials or production integrations;
- hard deletion of ledger/audit/alert history.

## Completion criteria

Task 005 is complete when Event Edge can derive live stock solely from an append-only ledger, replayed sales cannot duplicate depletion, transfers/counts are auditable state machines, deterministic alerts/replenishment work at location and event level during Cloud loss, Cloud/Control Web can consolidate the resulting operational state, and the full Task 001–004 regression gate plus Task 005 inventory failure suite is green.

## Completion record — 14 August 2026

Implementation is complete for the Task 005 scope. The final inventory slice includes immutable POS sale-line snapshots, integer-base-unit recipe depletion, Event Edge append-only ledger/projections, exact compensating reversals, custody-aware transfers, replay-safe physical counts, deterministic velocity/minutes-of-cover/event-wide/imbalance alerts, safe replenishment recommendations, alert ownership/escalation, isolated notification delivery, durable Edge→Cloud inventory consolidation, and the Control Web operations view.

Reliability hardening added during adversarial review:
- stock-decision advisory locking so concurrent sale/transfer/count decisions cannot read stale balances;
- semantic idempotency for ledger, transfer, receipt, count and Cloud replay paths;
- unresolved Cloud projection conflicts remain terminal reconciliation conflicts on replay;
- a durable `edge_inventory_sale_inbox` written in the same transaction as persisted closed-sale sync events, closing the crash window between sync durability and inventory consumption;
- bounded periodic recovery of pending sale inbox items with retry/backoff;
- inventory consumption only for sync receipts accepted or recognized as semantic duplicates; rejected conflicts cannot change stock;
- periodic Edge alert/escalation evaluation independent of Cloud forwarding;
- alert Cloud-outbox no-op suppression and single-source trigger emission;
- configured stock-imbalance ratio is enforced rather than merely stored.

Verification on implementation head `8be9f8318b68abdd1144732f3e993c9d80a5638d`:
- `pnpm install --frozen-lockfile` — passed in permanent CI;
- Cloud and Event Edge migrations through Edge `0007_inventory_sale_inbox.sql` — passed;
- `pnpm build` — passed;
- `pnpm lint` — passed;
- `pnpm typecheck` — passed;
- `pnpm test` — passed, including Cloud inventory conflict/replay tests and 27 Event Edge tests covering replay, recipe precision, concurrent stock decisions, transfer custody, counts/reversals, alerts/escalation, notification isolation, periodic recovery, durable-sale crash recovery and the sync/inventory conflict boundary;
- `pnpm format:check` — passed;
- `pnpm arch:check` — passed;
- `gradle -p apps/pos-android testDebugUnitTest lintDebug --stacktrace` — passed.

Both the Task 005 validation workflow and the permanent frozen CI workflow passed on that implementation tree. The temporary Task 005 validation workflow is removed before merge; permanent CI remains the repository gate.

Known deferred refinement: a future configuration-management slice should define explicit archive/reactivation semantics for inventory locations omitted from a refreshed event snapshot and exclude archived locations from automated source recommendations. Current configuration refreshes rebuild sales mappings, recipes, alert policy and responsibilities, so this does not alter the Task 005 transaction/ledger invariants, but it should be resolved before supporting live mid-event topology removal.

Recommended next slice: Task 006 — provider-neutral payment domain and M-PESA/Daraja integration, preserving payment-attempt history, provider idempotency, `UNKNOWN` reconciliation, and complete separation between payment-rail availability and local ordering durability.
