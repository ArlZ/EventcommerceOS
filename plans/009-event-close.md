# Task 009 — Event Close, Reconciliation & Audit

## Objective

Make an event operationally closeable while preserving unresolved financial and inventory truth. Closing is a control-plane action and immutable report snapshot, not a rewrite of commerce/payment/inventory ledgers.

## Source-of-truth rules

- Sales come from validated closed order projections.
- Discounts, comps, voids and cash refunds are append-only commerce adjustment records tied to an order.
- Electronic refunds/reversals come from the existing durable payment adjustment records.
- Payment success/unknown truth remains in immutable payment attempts + reconciliation jobs.
- Cash expected comes from orders explicitly closed as cash, less order-level reductions/cash refunds.
- Cash declarations are append-only; the latest declaration per event/location/device/cashier/currency scope is used.
- Inventory quantity variance comes from closed stock-count snapshots (`expectedQuantityBase` vs `countedQuantityBase`).
- Inventory variance value uses an explicit event/SKU base-unit cost declaration. Missing cost remains `MISSING_UNIT_COST`; selling price is never substituted.
- Transfer and alert exceptions come from their existing projections/control overlays.

## Close state

Close state is derived from append-only actions:

```text
OPEN -> OPERATIONALLY_CLOSED -> REOPENED -> OPERATIONALLY_CLOSED ...
```

Each `OPERATIONALLY_CLOSE` action stores:
- a monotonically increasing close revision;
- the full audit-oriented report JSON;
- a source-version token;
- SHA-256 of the canonical report payload;
- actor/reason/time.

A late provider callback after operational close may change live payment truth. It never rewrites a stored close revision. The live report compares its current source-version token to the last close revision and exposes `sourceChangedSinceLastClose`.

Reopening is a separate privileged append-only action with actor/reason. A new close after reopen produces the next report revision.

## Financial formulas

Per currency:

```text
gross sales = closed order totals
discounts = DISCOUNT adjustments
comps = COMP adjustments
voids = VOID adjustments
refunds = successful electronic refunds + CASH_REFUND adjustments
net sales = gross - discounts - comps - voids - refunds
```

Electronic tender uses one successful attempt per logical payment, less successful refunds/reversals. Cash expected is calculated independently from cash-closed orders. Sales-vs-tender variance is shown and is marked non-conclusive while unresolved payments remain.

Provider settlement bank/deposit data is not available in the current adapters, so the report must say `PROVIDER_SETTLEMENT_DATA_UNAVAILABLE` rather than imply settlement reconciliation.

## Drilldowns

Report all available event totals by:
- sales location/bar;
- device;
- cashier.

Cashier identity is optional in the current POS sync envelope. Legacy/current sessions without cashier identity remain explicit under an unassigned cashier bucket rather than being inferred from the device.

## Export

Expose:
- live JSON close report;
- immutable stored close revisions;
- deterministic multi-section CSV export suitable for audit/reconciliation review.

## Tests

Synthetic close fixture must include:
- normal provider and cash sales;
- discount, comp and void adjustments;
- successful refund;
- unknown payment that later becomes successful after operational close;
- inventory count variance with explicit unit cost;
- partial/unreceived transfer;
- cash declaration discrepancy;
- critical unresolved alert.

Assertions must prove totals/drilldowns reconcile to source ledgers, close snapshot remains immutable after late provider truth, live report flags post-close source change, and reopen/re-close creates a new audited revision.
