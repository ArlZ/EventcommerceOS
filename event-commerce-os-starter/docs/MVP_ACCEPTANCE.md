# MVP Acceptance Gates v0.1

A feature is not production-ready because its happy path works. These gates define the first pilot bar.

## Gate A — Event setup
- Event can be created from a template.
- At least two sales locations can have different menus/prices.
- Devices/users can be assigned/reassigned with audit history.

## Gate B — Local POS durability
- Create 100 orders with cloud unavailable.
- Kill/restart the POS after random committed operations.
- No acknowledged committed order is lost.
- UI remains responsive while sync is unavailable.

## Gate C — Synchronization
- Replay duplicate device events with exactly one business effect.
- Reorder events and either reconcile deterministically or raise an explicit exception.
- Recover from edge/cloud disconnect with complete convergence.

## Gate D — Inventory
- Opening stock, receipts, transfers, sales, wastage, comps and adjustments reconcile through ledger entries.
- Recipe sales deplete components correctly.
- Physical count creates traceable variance adjustment.

## Gate E — Inventory alerts
- Per-bar low-stock alert triggers from configured threshold.
- Minutes-of-cover alert triggers from live velocity.
- Critical alert can be acknowledged and assigned.
- Recommended transfer creates a real transfer workflow.
- Event-wide shortage is distinguished from a local shortage.
- Notification-provider failure does not affect sales/inventory updates.

## Gate F — Payments
- Duplicate initiation request cannot duplicate payment business effect.
- Duplicate webhook is safe.
- Delayed/unknown provider state does not incorrectly mark failure.
- Refund and reversal histories are preserved.
- No prohibited card data exists in logs/database.

## Gate G — Permissions & audit
- Bartender cannot access supervisor-only actions.
- Supervisor approvals are attributable.
- Audit events cannot be altered through application APIs.

## Gate H — Event close
- Sales reconcile by bar/device/payment method.
- Expected vs counted inventory and variance are visible.
- Unknown/unreconciled payments are explicit rather than hidden in totals.

## Pilot readiness

Run a controlled test event with real supported devices, local network, edge hardware and provider sandbox/test rails, then a limited live event before a major festival deployment.
