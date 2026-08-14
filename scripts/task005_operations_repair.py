from pathlib import Path

root = Path('.')

def load(path: str) -> str:
    return (root / path).read_text()

def save(path: str, text: str) -> None:
    (root / path).write_text(text)

# Pure imbalance rule.
save(
    'packages/domain/src/inventory-imbalance.ts',
    """export interface StockImbalanceInput {
  destinationAvailableBase: bigint;
  destinationInboundBase: bigint;
  sourceAvailableBase: bigint;
  sourceSafetyStockBase: bigint;
  minimumRatio: number;
}

export function isStockImbalanced(input: StockImbalanceInput): boolean {
  if (input.destinationInboundBase < 0n) throw new Error('destination inbound stock must not be negative');
  if (input.sourceSafetyStockBase < 0n) throw new Error('source safety stock must not be negative');
  if (!Number.isFinite(input.minimumRatio) || input.minimumRatio < 1) {
    throw new Error('imbalance ratio must be finite and at least 1');
  }

  const sourceSurplus =
    input.sourceAvailableBase > input.sourceSafetyStockBase
      ? input.sourceAvailableBase - input.sourceSafetyStockBase
      : 0n;
  if (sourceSurplus <= 0n) return false;

  const destinationEffective = input.destinationAvailableBase + input.destinationInboundBase;
  if (destinationEffective <= 0n) return true;

  const ratioBasisPoints = BigInt(Math.ceil(input.minimumRatio * 10_000));
  return sourceSurplus * 10_000n >= destinationEffective * ratioBasisPoints;
}
""",
)

path = 'packages/domain/src/index.ts'
text = load(path)
if "export * from './inventory-imbalance';" not in text:
    text = text.replace("export * from './inventory';\n", "export * from './inventory';\nexport * from './inventory-imbalance';\n", 1)
save(path, text)

save(
    'packages/domain/test/inventory-imbalance.test.ts',
    """import { describe, expect, it } from 'vitest';
import { isStockImbalanced } from '../src/inventory-imbalance';

describe('stock imbalance', () => {
  it('uses source surplus, inbound destination stock and configured ratio', () => {
    expect(
      isStockImbalanced({
        destinationAvailableBase: 20n,
        destinationInboundBase: 0n,
        sourceAvailableBase: 300n,
        sourceSafetyStockBase: 80n,
        minimumRatio: 2,
      }),
    ).toBe(true);

    expect(
      isStockImbalanced({
        destinationAvailableBase: 20n,
        destinationInboundBase: 100n,
        sourceAvailableBase: 300n,
        sourceSafetyStockBase: 80n,
        minimumRatio: 2,
      }),
    ).toBe(false);
  });

  it('treats a zero-stock destination with source surplus as imbalanced', () => {
    expect(
      isStockImbalanced({
        destinationAvailableBase: 0n,
        destinationInboundBase: 0n,
        sourceAvailableBase: 50n,
        sourceSafetyStockBase: 10n,
        minimumRatio: 3,
      }),
    ).toBe(true);
  });
});
""",
)

# Periodic Edge operations loop: refresh time-dependent alerts/escalations without touching POS acknowledgement path.
save(
    'apps/event-edge/src/inventory/inventory-operations-loop.service.ts',
    """import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryNotificationService } from './inventory-notification.service';

interface EventIdRow extends QueryResultRow {
  event_id: string;
}

@Injectable()
export class InventoryOperationsLoopService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
    @Inject(InventoryAlertService) private readonly alerts: InventoryAlertService,
    @Inject(InventoryNotificationService)
    private readonly notifications: InventoryNotificationService,
  ) {}

  onModuleInit(): void {
    if (
      process.env.EDGE_FORWARDER_DISABLED === 'true' ||
      process.env.INVENTORY_BACKGROUND_DISABLED === 'true'
    ) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<{ eventsEvaluated: number }> {
    const rows = await this.database.query<EventIdRow>(
      `SELECT event_id FROM edge_inventory_event_config
       WHERE event_end_at >= $1::timestamptz - interval '6 hours'
       ORDER BY event_id`,
      [now.toISOString()],
    );

    for (const row of rows) {
      try {
        await this.alerts.evaluateEvent(row.event_id, now);
      } catch {
        // Alert calculation is recoverable and must never affect inventory truth.
      }
      try {
        await this.alerts.runEscalations(row.event_id, now);
      } catch {
        // Escalation failure is retried on the next cycle.
      }
    }

    try {
      await this.notifications.drainOnce();
    } catch {
      // Notification delivery is isolated from inventory and alert state.
    }
    return { eventsEvaluated: rows.length };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } finally {
      this.running = false;
    }
  }
}
""",
)

# Wire periodic loop into inventory module.
path = 'apps/event-edge/src/inventory/inventory.module.ts'
text = load(path)
if "inventory-operations-loop.service" not in text:
    text = text.replace(
        "import { InventoryNotificationService } from './inventory-notification.service';\n",
        "import { InventoryNotificationService } from './inventory-notification.service';\n"
        "import { InventoryOperationsLoopService } from './inventory-operations-loop.service';\n",
        1,
    )
    text = text.replace(
        "    InventoryNotificationService,\n    InventoryCloudForwarderService,\n",
        "    InventoryNotificationService,\n    InventoryOperationsLoopService,\n    InventoryCloudForwarderService,\n",
        1,
    )
save(path, text)

# Alert engine: use ratio, suppress no-op updates, rely on DB trigger as single Cloud outbox source.
path = 'apps/event-edge/src/inventory/inventory-alert.service.ts'
text = load(path)
text = text.replace(
    "  evaluateStockRisk,\n  minutesOfCover,\n",
    "  evaluateStockRisk,\n  isStockImbalanced,\n  minutesOfCover,\n",
    1,
)

old = """    if (localType && suggested > 0n) {
      await this.upsertAlert({
"""
new = """    const imbalanced =
      source !== null &&
      isStockImbalanced({
        destinationAvailableBase: onHand,
        destinationInboundBase: inbound,
        sourceAvailableBase: BigInt(source.available),
        sourceSafetyStockBase: BigInt(source.safety_stock),
        minimumRatio: Number(config.imbalance_ratio),
      });

    if (localType && suggested > 0n && imbalanced) {
      await this.upsertAlert({
"""
if old not in text:
    raise SystemExit('imbalance condition anchor missing')
text = text.replace(old, new, 1)

old = """          `UPDATE edge_inventory_alerts SET severity = $2, available_quantity = $3,
             minutes_of_cover = $4, suggested_source_location_id = $5,
             suggested_transfer_quantity = $6, responsible_actor_id = $7,
             details = $8::jsonb, updated_at = now()
           WHERE id = $1`,
"""
new = """          `UPDATE edge_inventory_alerts SET severity = $2, available_quantity = $3,
             minutes_of_cover = $4, suggested_source_location_id = $5,
             suggested_transfer_quantity = $6, responsible_actor_id = $7,
             details = $8::jsonb, updated_at = now()
           WHERE id = $1 AND (
             severity IS DISTINCT FROM $2 OR
             available_quantity IS DISTINCT FROM $3::bigint OR
             minutes_of_cover IS DISTINCT FROM $4::numeric OR
             suggested_source_location_id IS DISTINCT FROM $5 OR
             suggested_transfer_quantity IS DISTINCT FROM $6::bigint OR
             responsible_actor_id IS DISTINCT FROM $7 OR
             details IS DISTINCT FROM $8::jsonb
           )`,
"""
if old not in text:
    raise SystemExit('alert no-op update anchor missing')
text = text.replace(old, new, 1)

# Remove explicit queueCloud calls: migration trigger is the single durable alert outbox writer.
text = text.replace("      await this.queueCloud(client, updated);\n      return this.map(updated);", "      return this.map(updated);", 1)
text = text.replace("      await this.queueCloud(client, alert);\n", "", 1)
text = text.replace(
    "      await this.queueCloud(client, await this.alert(client, alert.id, false));\n",
    "",
    1,
)

start = text.find("  private async queueCloud(client: PoolClient, alert: AlertDbRow): Promise<void> {")
if start == -1:
    raise SystemExit('alert queueCloud method anchor missing')
end = text.find("  private async alert(client: PoolClient", start)
if end == -1:
    raise SystemExit('alert method anchor missing after queueCloud')
text = text[:start] + text[end:]
save(path, text)

# Integration test: prove configured ratio controls STOCK_IMBALANCE lifecycle.
path = 'apps/event-edge/test/inventory-alerts.integration.test.ts'
text = load(path)
anchor = """    expect(local!.suggestedTransferQuantityBase).toBe('112');
    expect(active.some((alert) => alert.alertType === 'EVENT_WIDE_STOCKOUT_RISK')).toBe(false);

    await ledger.postManual({
"""
replacement = """    expect(local!.suggestedTransferQuantityBase).toBe('112');
    expect(active.some((alert) => alert.alertType === 'EVENT_WIDE_STOCKOUT_RISK')).toBe(false);
    expect(active.some((alert) => alert.alertType === 'STOCK_IMBALANCE')).toBe(true);

    await database.query(
      `UPDATE edge_inventory_alert_config SET imbalance_ratio = 100
       WHERE id = 'alert-main-beer'`,
    );
    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:00:30.000Z'));
    active = (await alerts.list(inventoryEventId)).filter((alert) => alert.state !== 'RESOLVED');
    expect(active.some((alert) => alert.alertType === 'STOCK_IMBALANCE')).toBe(false);

    await ledger.postManual({
"""
if anchor not in text:
    raise SystemExit('imbalance integration anchor missing')
text = text.replace(anchor, replacement, 1)
save(path, text)

# Periodic loop integration test.
save(
    'apps/event-edge/test/inventory-operations-loop.integration.test.ts',
    """import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryAlertService } from '../src/inventory/inventory-alert.service';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import { InventoryOperationsLoopService } from '../src/inventory/inventory-operations-loop.service';
import { InventorySaleConsumerService } from '../src/inventory/inventory-sale-consumer.service';
import {
  beerSkuId,
  closedSale,
  escalationActorId,
  installInventoryFixture,
  inventoryEventId,
  mainLocationId,
  receipt,
  resetInventory,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory periodic operations loop', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;
  let sales: InventorySaleConsumerService;
  let alerts: InventoryAlertService;
  let loop: InventoryOperationsLoopService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
    sales = moduleRef.get(InventorySaleConsumerService);
    alerts = moduleRef.get(InventoryAlertService);
    loop = moduleRef.get(InventoryOperationsLoopService);
    await app.init();
  });

  beforeEach(async () => {
    await resetInventory(database);
    await installInventoryFixture(configuration);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('refreshes time-dependent alerts and runs escalation without an operator request', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 30n, 'loop-main');
    await sales.consume([
      closedSale({
        eventInstanceId: 'loop-sale-201',
        occurredAt: '2026-08-14T07:55:00.000Z',
        lines: [{ skuId: beerSkuId, quantity: 20 }],
      }),
    ]);
    await alerts.evaluateEvent(inventoryEventId, new Date('2026-08-14T08:00:00.000Z'));

    const result = await loop.runOnce(new Date('2026-08-14T08:10:00.000Z'));
    expect(result.eventsEvaluated).toBe(1);

    const escalation = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_notification_outbox
       WHERE recipient_actor_id = $1 AND payload->>'reason' = 'escalation'`,
      [escalationActorId],
    );
    expect(Number(escalation[0]!.count)).toBeGreaterThanOrEqual(1);
  });
});
""",
)

# Remove temporary mechanism in resulting commit.
for temporary in [
    'scripts/task005_operations_repair.py',
    '.github/workflows/task005-operations-repair.yml',
]:
    p = root / temporary
    if p.exists():
        p.unlink()
