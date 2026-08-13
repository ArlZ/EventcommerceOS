# Codex Task 005 — Inventory Ledger, Alerts & Replenishment

Read `AGENTS.md`, `docs/INVENTORY.md`, `docs/PRODUCT.md`, `docs/DOMAIN_MODEL.md` and existing order/sync code.

## Objective

Build the event inventory engine, including the low-stock functionality as a first-class operational workflow.

## Required capabilities

### Ledger
- opening balances/receipts;
- transfer out/in;
- sale/recipe consumption;
- wastage;
- breakage;
- comp;
- count adjustment;
- reversal/correction entries.

Current stock must be a projection from ledger entries.

### Transfers
Implement lifecycle:

```text
REQUESTED -> ASSIGNED -> PICKING -> IN_TRANSIT -> RECEIVED
```

Support partial receipt and cancellation rules. Every transition must be authorized and auditable.

### Recipes
Allow a sold product to consume components/base units.

### Alert engine
Implement configurable:
- absolute low-stock threshold;
- minutes-of-cover threshold;
- projected stockout before event end;
- event-wide shortage;
- stock imbalance.

Compute velocity using a deterministic rolling-window approach with tests around zero/low velocity and spikes.

### Replenishment
A critical/local stockout risk should be capable of producing a suggested source + suggested transfer quantity based on target cover, source surplus, stock already in transit and safety stock.

Do not auto-dispatch in MVP. Human approves/assigns the transfer.

### Alert workflow

```text
OPEN -> ACKNOWLEDGED -> ASSIGNED -> RESOLVED
```

Route by event inventory responsibility configuration and support escalation timers internally. In-app notifications are required; external SMS/WhatsApp should be adapter interfaces/stubs unless credentials/providers are explicitly available.

## Control Web

Add an inventory operations view optimized around:
- critical alerts first;
- minutes of cover;
- location/product;
- warehouse availability;
- suggested transfer;
- transfer status.

## Required tests

- concurrent sales and transfer movements;
- duplicate sale event does not duplicate stock depletion;
- partial receipt;
- count adjustment preserving history;
- recipe conversion precision;
- location stockout while event-wide stock remains healthy;
- event-wide stockout risk;
- notification failure does not affect inventory transaction;
- alert acknowledgement/escalation state;
- replenishment recommendation never takes source below configured safety stock.
