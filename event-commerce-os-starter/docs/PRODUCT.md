# Product Specification v0.1

## 1. Vision

Build the operating system for temporary event commerce, beginning with bars. One operator should be able to configure, run, monitor and reconcile many bar areas as one business while each bar remains operational during connectivity problems.

## 2. Product promise

**Keep selling. Know what is happening. Never lose control of money or stock.**

## 3. Primary users

### Bartender / Cashier
Needs to find products, build an order and take payment with almost no training.

### Bar Supervisor
Runs one sales location, handles approvals, local stock, staff and exceptions.

### Inventory Manager
Owns event-wide stock availability, replenishment, transfers, counts, breakages and variance.

### Stock Controller / Runner
Picks, moves and confirms stock transfers between inventory locations.

### Event Manager
Needs a live view of sales, bar health, payment health, inventory risk and incidents.

### Finance
Needs settlement, reconciliation, refunds, payment exceptions, cash-up and audit trails.

### Organisation Admin
Creates event templates, users, catalogues, permissions, devices and organisation settings.

## 4. Core event model

```text
Organisation
  └── Event
      ├── Sales Locations (BAR, FOOD, MERCH, VIP...)
      │   ├── Registers
      │   └── Devices
      ├── Inventory Locations
      │   ├── Central Warehouse
      │   └── Per-location stock rooms
      ├── Menus / Prices
      ├── Staff / Shifts / Permissions
      └── Payment configuration
```

## 5. MVP capabilities

### Event setup
- Create event from template or scratch.
- Create sales and inventory locations.
- Assign menus, prices, products and availability by location.
- Assign devices and staff.
- Configure payment methods and receipt behaviour.

### POS
- Fast product grid with favourites and categories.
- Add/remove quantities.
- Bundles where configured.
- M-PESA, card, cash and externally-recorded payment modes.
- Clear pending/success/failure/unknown payment states.
- Reprint/re-display receipt.
- Local transaction history.
- Supervisor-controlled void/refund/comp flows.
- Offline-first order capture.

### Inventory
- Receive stock.
- Allocate and transfer stock between locations.
- Sale-driven depletion.
- Recipe/component depletion.
- Wastage, breakage, comp and adjustment movements.
- Physical counts and variance.
- Low stock, minutes-of-cover and projected-stockout alerts.
- Suggested replenishment and transfer workflow.

### Live event control
- Revenue, transactions, average order value and sales velocity.
- Sales by bar/device/product/payment method.
- Device/sync health.
- Payment-provider health and unknown payments.
- Inventory risk dashboard.
- Alerts requiring acknowledgement/action.

### Finance & close
- Gross/net sales.
- Payment-method reconciliation.
- Refunds, voids, comps and discounts.
- Inventory expected vs actual.
- Variance value.
- Cash reconciliation where cash is enabled.
- Full audit trail.

## 6. Inventory intelligence

Every inventory-affecting event recalculates relevant risk.

### Required metrics
- stock on hand;
- stock available;
- stock in transit;
- recent sales velocity;
- minutes of cover;
- projected time to stockout;
- projected end-of-event requirement;
- event-wide remaining stock;
- per-location imbalance;
- theoretical vs actual usage where counts exist.

### Alert classes
- `LOW_STOCK`
- `STOCKOUT_RISK`
- `CRITICAL_STOCKOUT_RISK`
- `EVENT_WIDE_STOCKOUT_RISK`
- `ABNORMAL_DEPLETION`
- `HIGH_VARIANCE`
- `TRANSFER_DELAY`
- `UNCONFIRMED_RECEIPT`
- `STOCK_IMBALANCE`
- `EXCESS_STOCK`

### Alert workflow

```text
DETECTED
  -> OPEN
  -> ACKNOWLEDGED
  -> ASSIGNED
  -> RESOLVED
```

Escalation may occur when an alert remains unacknowledged or unresolved beyond configurable thresholds.

Notifications should support in-app push first, with SMS/WhatsApp adapters later. Notification failure must not affect sales.

## 7. Event-native requirements

- Multiple bars use one event catalogue but can have different menus/prices.
- Bar-specific sold-out state.
- Event-wide sold-out state.
- Temporary staff provisioning.
- Device reassignment during an event.
- Stock runner workflows.
- Sponsor/artist/staff comps.
- VIP/hospitality accounts later.
- Event templates and rapid duplication.

## 8. Out of scope for first production release

- Consumer self-ordering.
- Loyalty programme.
- NFC/wristband wallet.
- AI demand forecasting beyond deterministic/rules-based velocity calculations.
- Computer-vision queue measurement.
- Supplier procurement automation.
- Multi-country tax/payment abstraction beyond interfaces needed for future expansion.

## 9. Success metrics

### Operational
- Median item-to-payment-start time.
- p95 completed checkout duration by payment rail.
- transactions per register per minute.
- device crash-free session rate.
- percentage of sales completed while cloud-disconnected.
- sync recovery success rate.

### Inventory
- stockout incidents of top products;
- alert-to-acknowledge time;
- alert-to-replenishment time;
- end-of-event variance rate;
- transfer confirmation time.

### Financial
- unknown payment rate;
- duplicate charge incidents;
- unreconciled payment value;
- refund/void exception rate.
