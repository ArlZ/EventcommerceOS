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
