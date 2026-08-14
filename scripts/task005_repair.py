from pathlib import Path
import re

root = Path('.')


def load(path: str) -> str:
    return (root / path).read_text()


def save(path: str, text: str) -> None:
    (root / path).write_text(text)


# Explicit Nest DI tokens for all Task 005 Edge constructor dependencies.
files = [
    'apps/event-edge/src/inventory/inventory-alert.service.ts',
    'apps/event-edge/src/inventory/inventory-cloud-forwarder.service.ts',
    'apps/event-edge/src/inventory/inventory-configuration.service.ts',
    'apps/event-edge/src/inventory/inventory-count.service.ts',
    'apps/event-edge/src/inventory/inventory-ledger.service.ts',
    'apps/event-edge/src/inventory/inventory-notification.service.ts',
    'apps/event-edge/src/inventory/inventory-sale-consumer.service.ts',
    'apps/event-edge/src/inventory/inventory-transfer.service.ts',
    'apps/event-edge/src/inventory/inventory.controller.ts',
    'apps/event-edge/src/sync/device-sync.controller.ts',
]

token_types = [
    'EdgeDatabaseService',
    'InventoryAuthorizationService',
    'InventoryLedgerService',
    'InventoryNotificationTransport',
    'InventoryConfigurationService',
    'InventoryTransferService',
    'InventoryCountService',
    'InventoryAlertService',
    'InventoryNotificationService',
    'InventorySaleConsumerService',
]

for path in files:
    text = load(path)
    m = re.search(r"import \{([^}]*)\} from '@nestjs/common';", text)
    if not m:
        raise SystemExit(f'No Nest import found in {path}')
    names = [x.strip() for x in m.group(1).split(',')]
    if 'Inject' not in names:
        names.insert(0, 'Inject')
        replacement = "import { " + ', '.join(names) + " } from '@nestjs/common';"
        text = text[: m.start()] + replacement + text[m.end() :]
    for typ in token_types:
        text = re.sub(
            rf'(?<!@Inject\({re.escape(typ)}\) )private readonly (\w+): {re.escape(typ)}',
            rf'@Inject({typ}) private readonly \1: {typ}',
            text,
        )
    save(path, text)


# Cloud: sticky conflicts and idempotency preflight under an advisory lock.
path = 'apps/cloud-api/src/inventory/inventory.service.ts'
text = load(path)
old = """      if (same) return 'DUPLICATE';
      await this.exception(client, 'INVENTORY_EDGE_EVENT_REUSE', event.id, {
"""
new = """      if (same) {
        const unresolved = await client.query(
          `SELECT 1 FROM inventory_reconciliation_exceptions
           WHERE edge_event_id = $1 AND resolved_at IS NULL LIMIT 1`,
          [event.id],
        );
        return unresolved.rowCount === 1 ? 'CONFLICT' : 'DUPLICATE';
      }
      await this.exception(client, 'INVENTORY_EDGE_EVENT_REUSE', event.id, {
"""
if old not in text:
    raise SystemExit('Cloud sticky-conflict anchor missing')
text = text.replace(old, new, 1)

old = """    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (
        row.event_id !== values.eventId ||
        row.inventory_location_id !== values.inventoryLocationId ||
        row.sku_id !== values.skuId ||
        row.movement_type !== values.movementType ||
        row.quantity_delta !== values.quantityDeltaBase ||
        row.idempotency_key !== values.idempotencyKey
      ) {
        throw new Error('ledger entry ID reused with different content');
      }
      return;
    }
    await client.query(
      `INSERT INTO inventory_ledger(
"""
new = """    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (
        row.event_id !== values.eventId ||
        row.inventory_location_id !== values.inventoryLocationId ||
        row.sku_id !== values.skuId ||
        row.movement_type !== values.movementType ||
        row.quantity_delta !== values.quantityDeltaBase ||
        row.idempotency_key !== values.idempotencyKey
      ) {
        throw new Error('ledger entry ID reused with different content');
      }
      return;
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `inventory-ledger-idempotency:${values.idempotencyKey}`,
    ]);
    const idempotencyExisting = await client.query<LedgerRow>(
      `SELECT id, event_id, inventory_location_id, sku_id, movement_type,
              quantity_delta::text, idempotency_key
       FROM inventory_ledger WHERE idempotency_key = $1`,
      [values.idempotencyKey],
    );
    if (idempotencyExisting.rowCount === 1) {
      const row = idempotencyExisting.rows[0]!;
      if (
        row.id !== id ||
        row.event_id !== values.eventId ||
        row.inventory_location_id !== values.inventoryLocationId ||
        row.sku_id !== values.skuId ||
        row.movement_type !== values.movementType ||
        row.quantity_delta !== values.quantityDeltaBase
      ) {
        throw new Error('ledger idempotency key reused with different content');
      }
      return;
    }

    await client.query(
      `INSERT INTO inventory_ledger(
"""
if old not in text:
    raise SystemExit('Cloud ledger preflight anchor missing')
text = text.replace(old, new, 1)
save(path, text)


# Alert tests: use real closed-sale consumption for sales velocity.
path = 'apps/event-edge/test/inventory-alerts.integration.test.ts'
text = load(path)
if "InventorySaleConsumerService" not in text:
    text = text.replace(
        "import { InventoryNotificationService } from '../src/inventory/inventory-notification.service';\n",
        "import { InventoryNotificationService } from '../src/inventory/inventory-notification.service';\n"
        "import { InventorySaleConsumerService } from '../src/inventory/inventory-sale-consumer.service';\n",
        1,
    )
if '  closedSale,\n' not in text:
    text = text.replace('  beerSkuId,\n', '  beerSkuId,\n  closedSale,\n', 1)
if '  let sales: InventorySaleConsumerService;\n' not in text:
    text = text.replace(
        '  let ledger: InventoryLedgerService;\n',
        '  let ledger: InventoryLedgerService;\n  let sales: InventorySaleConsumerService;\n',
        1,
    )
if '    sales = moduleRef.get(InventorySaleConsumerService);\n' not in text:
    text = text.replace(
        '    ledger = moduleRef.get(InventoryLedgerService);\n',
        '    ledger = moduleRef.get(InventoryLedgerService);\n'
        '    sales = moduleRef.get(InventorySaleConsumerService);\n',
        1,
    )

old = """    await ledger.postManual({
      id: 'alert-sale-history',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      skuId: beerSkuId,
      movementType: 'SALE',
      quantityDeltaBase: '-30',
      actorId: operatorActorId,
      reason: 'recent sales velocity',
      occurredAt: '2026-08-14T07:55:00.000Z',
      idempotencyKey: 'alert-sale-history',
    });
"""
new = """    await sales.consume([
      closedSale({
        eventInstanceId: 'alert-sale-101',
        occurredAt: '2026-08-14T07:55:00.000Z',
        lines: [{ skuId: beerSkuId, quantity: 30 }],
      }),
    ]);
"""
if old not in text:
    raise SystemExit('First alert SALE fixture anchor missing')
text = text.replace(old, new, 1)

old = """    await ledger.postManual({
      id: 'workflow-sale',
      eventId: inventoryEventId,
      inventoryLocationId: mainLocationId,
      skuId: beerSkuId,
      movementType: 'SALE',
      quantityDeltaBase: '-20',
      actorId: operatorActorId,
      reason: 'create risk',
      occurredAt: '2026-08-14T07:55:00.000Z',
      idempotencyKey: 'workflow-sale',
    });
"""
new = """    await sales.consume([
      closedSale({
        eventInstanceId: 'workflow-sale-102',
        occurredAt: '2026-08-14T07:55:00.000Z',
        lines: [{ skuId: beerSkuId, quantity: 20 }],
      }),
    ]);
"""
if old not in text:
    raise SystemExit('Second alert SALE fixture anchor missing')
text = text.replace(old, new, 1)
save(path, text)

# Remove accidental probe; workflow/script remove themselves before commit.
for temporary in [
    'apps/event-edge/test/inventory-alerts.integration.test.ts.tmp',
    '.github/workflows/task005-repair.yml',
    'scripts/task005_repair.py',
]:
    p = root / temporary
    if p.exists():
        p.unlink()
