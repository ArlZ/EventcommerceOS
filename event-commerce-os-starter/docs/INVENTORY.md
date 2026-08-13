# Inventory & Replenishment Specification v0.1

## Objective

Know what stock exists, where it is, who moved it, what should remain, which location will run out next and what action the inventory team should take.

## Source of truth

Inventory is an append-only ledger. Stock-on-hand is a projection.

## Quantity model

Products/components must define a base inventory unit. Examples:
- bottled beer: each;
- spirits: ml;
- syrup: ml;
- cups: each.

Recipes convert a sale into component consumption.

## Stock states

Track at minimum:
- on hand;
- committed/reserved where needed;
- in transit;
- available;
- expected from open transfers.

## Transfers

A transfer records custody and workflow, not just two inventory edits.

```text
REQUESTED -> ASSIGNED -> PICKING -> DISPATCHED/IN_TRANSIT -> RECEIVED
```

Sender and receiver confirmations should be attributable. Partial receipt is supported.

## Counts

Physical counts do not silently replace ledger truth. Closing a count creates adjustment entries with variance and reason/approval policy.

## Low-stock engine

Run evaluation on:
- sale/recipe consumption;
- stock receipt;
- transfer dispatch/receipt/cancel;
- wastage/breakage/comp;
- stock adjustment/count close;
- periodic timer for time-dependent forecasts.

### Configurable threshold layers
1. Absolute minimum quantity.
2. Percentage of opening/target allocation.
3. Minutes-of-cover threshold.
4. Projected stockout before event end.
5. Event-wide safety stock.

### Velocity

Use configurable rolling windows. A simple initial method can blend short and medium windows to avoid one burst causing unstable alerts.

Example:

```text
short_rate = units sold in last 10m / 10
medium_rate = units sold in last 30m / 30
blended_rate = weighted blend
minutes_of_cover = available_stock / blended_rate
```

Guard against zero/near-zero velocity.

### Recommended transfer

Recommendation should consider:
- destination target cover;
- source location surplus;
- warehouse stock;
- event-wide stock;
- transfer already in transit;
- minimum source safety stock.

Never auto-dispatch stock in MVP. Create a recommendation requiring human assignment/confirmation.

## Alert routing

Each event can assign inventory responsibility by location/category. Route alerts to the responsible inventory user(s), then escalate based on configurable policy.

Example:

```text
CRITICAL_STOCKOUT_RISK
Main Stage / Tusker
31 units available
9 minutes of cover
Warehouse: 742
Suggested transfer: 180
```

Actions:
- acknowledge;
- assign runner;
- create transfer;
- snooze with reason/permission;
- resolve.

## Event-wide shortage

If total available + inbound stock is insufficient for projected event demand, raise a separate event-wide alert. This signals procurement/substitution/menu action rather than redistribution.

## Variance

Where recipe usage is configured:

```text
theoretical_usage = sales-derived consumption
actual_usage = opening + receipts + transfer_in - transfer_out - closing_count - other known movements
variance = actual_usage - theoretical_usage
```

Flag unusual variance by value and percentage thresholds.
