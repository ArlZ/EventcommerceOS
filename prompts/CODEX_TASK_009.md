# Codex Task 009 — Event Close, Reconciliation & Audit

Read payment, inventory and domain docs and inspect all existing ledgers/state machines.

## Objective

Make the event financially and operationally closeable without hiding uncertainty.

## Required close view

- gross sales;
- discounts/comps;
- refunds/voids;
- net sales;
- totals by payment method;
- provider settlement/reconciliation status where data is available;
- cash expected/declared/variance where cash is enabled;
- inventory expected vs physical count;
- variance quantity and value;
- unresolved/unknown payments;
- open/unreceived transfers;
- unresolved critical alerts;
- per-bar/device/cashier drilldown;
- exportable audit-oriented report.

## Rules

- Unknown payments remain explicit. Never force totals to appear reconciled.
- Closing an event must not delete or rewrite transaction history.
- Late provider callbacks after operational close must be handled through controlled post-close reconciliation.
- Reopening/adjusting close state requires privileged audit trail.

## Tests

Create synthetic events containing:
- normal sales;
- refunds;
- voids;
- comps;
- unknown then late-success payment;
- stock variance;
- partial transfer;
- cash discrepancy.

Prove report totals and drilldowns reconcile to source ledgers.
