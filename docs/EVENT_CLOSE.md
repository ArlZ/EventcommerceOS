# Event Close, Reconciliation & Audit

Event close is a control-plane workflow over immutable commerce, payment and inventory truth. It is not a command to rewrite or delete transaction history.

## Operational close state

The close state is derived from append-only actions:

```text
OPEN -> OPERATIONALLY_CLOSED -> REOPENED -> OPERATIONALLY_CLOSED ...
```

An operational close creates an immutable numbered report revision. The revision stores the complete audit report, the source-version token used to build it, the closing actor/reason/time and SHA-256 of the exact serialized report JSON.

A second close is rejected while the event remains operationally closed. A privileged admin must explicitly reopen with a reason before making corrections and creating a later close revision.

## Late provider truth

A payment may remain `UNKNOWN` at operational close. Closing does not convert it to failure or success.

If authoritative provider truth arrives later:

1. the normal payment reconciliation path updates the live payment attempt;
2. the stored close revision remains unchanged;
3. the live close report exposes `sourceChangedSinceLastClose = true`;
4. the operator may review, reopen and create a new close revision.

The source-version token includes the relevant order, payment, refund/reversal, cash, count, inventory, transfer and alert sources. Close actions/reports themselves are intentionally excluded, so performing a close does not immediately make its own snapshot stale.

## Sales and tender truth

Per currency:

```text
gross sales = validated closed order totals
net sales = gross - discounts - comps - voids - refunds
refunds = successful electronic refunds + cash refund adjustments
```

Discounts, comps, voids and cash refunds are append-only order adjustments. They require actor, reason and idempotency. Cumulative discounts/comps/voids cannot exceed order gross value. Cash refunds may only target cash-closed orders and cannot exceed the remaining cash value.

Electronic tender selects one successful payment attempt per logical payment and subtracts successful payment refunds/reversals. Cash expected is derived only from orders explicitly closed by the POS as `ORDER_CLOSED_CASH`.

Cash declarations are append-only. The latest declaration for the exact event/location/device/cashier/currency scope is compared with expected cash. Missing declarations remain explicit. Cash shortages/overages remain visible as a sales-to-tender variance; they are never silently forced to zero.

## Provider reconciliation vs settlement

Event Commerce OS can reconcile transaction truth from payment attempts and provider verification. The current adapters do not supply acquirer settlement files or bank-deposit data.

The close report therefore distinguishes:

- transaction reconciliation: `RECONCILED` or `UNRESOLVED`;
- settlement status: `PROVIDER_SETTLEMENT_DATA_UNAVAILABLE`.

The system must not claim bank/acquirer settlement reconciliation without an authoritative settlement source.

## Inventory close

Physical-count variance comes from closed inventory count snapshots:

```text
variance quantity = physical count - expected quantity at count close
```

Count closing continues to post an append-only stock adjustment; it does not reset inventory balances.

Variance value requires an explicit event/SKU base-unit cost declaration:

```text
variance value = variance quantity x declared base-unit cost
```

Selling price is never substituted for cost. If no cost has been declared, quantity variance is still reported and valuation remains `MISSING_UNIT_COST`.

Open/unreceived transfers and unresolved critical inventory alerts remain visible exceptions at close.

## Drilldowns

The audit report provides sales reconciliation by:

- sales location/bar;
- POS device;
- cashier.

Cashier identity is optional in the current POS sync envelope. Missing cashier identity is reported under an explicit unassigned bucket and is not inferred from the device.

## Audit export

The live report and every immutable close revision can be exported as a deterministic multi-section CSV. Stored close revisions also expose:

- revision number;
- source-version token;
- SHA-256;
- closing actor;
- close timestamp.

CSV sections cover sales, payment methods, provider reconciliation, cash, inventory variance, unresolved payments, open transfers, critical alerts, drilldowns and sales-to-tender reconciliation.
