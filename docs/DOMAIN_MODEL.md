# Domain Model v0.1

## Core entities

### Organisation & event
- `Organisation`
- `Venue`
- `Event`
- `SalesLocation`
- `InventoryLocation`
- `Register`
- `Device`
- `User`
- `Role`
- `Shift`

### Catalogue
- `Product`
- `Sku`
- `Category`
- `Menu`
- `MenuItem`
- `Price`
- `Recipe`
- `RecipeComponent`

### Commerce
- `Order`
- `OrderItem`
- `OrderAdjustment`
- `Payment`
- `PaymentAttempt`
- `Refund`

### Inventory
- `StockLedgerEntry`
- `StockTransfer`
- `StockTransferLine`
- `StockCount`
- `StockCountLine`
- `StockAdjustment`

### Operations
- `Alert`
- `AlertAssignment`
- `NotificationDelivery`
- `DeviceHeartbeat`
- `SyncEvent`
- `AuditEvent`

## Key principles

### IDs
Use globally unique immutable identifiers generated safely offline.

### Money
Represent amounts as:

```text
amount_minor: integer
currency: ISO code
```

### Time
Persist UTC timestamps; retain event-local timezone for display/business rules.

### Order state

```text
DRAFT
OPEN
PAYMENT_PENDING
PAID
FULFILLED
CLOSED
VOIDED
PARTIALLY_REFUNDED
REFUNDED
```

An order may additionally expose a derived operational warning when payment truth is unresolved. Do not encode contradictory booleans.

### Payment attempt state

```text
CREATED
INITIATED
PENDING
SUCCESS
FAILED
EXPIRED
UNKNOWN
REVERSED
```

`UNKNOWN` means the system cannot yet determine provider truth and must reconcile/query before allowing unsafe assumptions.

### Stock transfer state

```text
DRAFT
REQUESTED
ASSIGNED
PICKING
DISPATCHED
IN_TRANSIT
RECEIVED
PARTIALLY_RECEIVED
CANCELLED
```

Dispatch and receipt generate ledger movements appropriate to the chosen custody model.

### Alert state

```text
OPEN
ACKNOWLEDGED
ASSIGNED
RESOLVED
DISMISSED
```

Dismissal requires permission and a reason.

## Ledger rule

Current stock is a projection over ledger entries, not a mutable authoritative counter.

Suggested movement types:

```text
RECEIPT
TRANSFER_OUT
TRANSFER_IN
SALE
RECIPE_CONSUMPTION
WASTAGE
BREAKAGE
COMP
COUNT_ADJUSTMENT
RETURN_TO_WAREHOUSE
SUPPLIER_RETURN
REVERSAL
```

Every movement includes:
- event;
- inventory location;
- SKU/component;
- quantity in a base unit;
- source reference;
- actor/device when applicable;
- timestamp;
- reason where required.

## Audit

Privileged actions create `AuditEvent` records. Audit is append-only and includes before/after references or structured change context without logging secrets.
