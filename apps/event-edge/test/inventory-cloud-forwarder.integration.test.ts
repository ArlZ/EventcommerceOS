import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InventoryEdgeBatch } from '@event-commerce/contracts';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { InventoryCloudForwarderService } from '../src/inventory/inventory-cloud-forwarder.service';
import type { InventoryCloudTransport } from '../src/inventory/inventory-cloud.transport';
import { InventoryConfigurationService } from '../src/inventory/inventory-configuration.service';
import { InventoryLedgerService } from '../src/inventory/inventory-ledger.service';
import {
  beerSkuId,
  installInventoryFixture,
  mainLocationId,
  receipt,
  resetInventory,
} from './inventory-fixture';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('inventory Edge to Cloud forwarder', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let configuration: InventoryConfigurationService;
  let ledger: InventoryLedgerService;

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    configuration = moduleRef.get(InventoryConfigurationService);
    ledger = moduleRef.get(InventoryLedgerService);
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

  it('keeps durable backlog through Cloud outage and replays the same event IDs after recovery', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 100n, 'cloud-forwarder');
    let cloudAvailable = false;
    const batches: InventoryEdgeBatch[] = [];
    const transport: InventoryCloudTransport = {
      async send(batch) {
        batches.push(batch);
        if (!cloudAvailable) throw new Error('simulated inventory Cloud outage after request');
        return {
          acceptedIds: batch.events.map((event) => event.id),
          duplicateIds: [],
          conflictIds: [],
          serverTime: new Date().toISOString(),
        };
      },
    };
    const forwarder = new InventoryCloudForwarderService(database, transport);
    const backlogBefore = await forwarder.backlogCount();
    expect(backlogBefore).toBeGreaterThanOrEqual(2);

    const failed = await forwarder.drainOnce();
    expect(failed.sent).toBe(0);
    expect(failed.backlog).toBe(backlogBefore);
    const firstIds = batches[0]!.events.map((event) => event.id);

    await database.query(
      `UPDATE edge_inventory_cloud_outbox
       SET next_attempt_at = now() WHERE delivered_at IS NULL`,
    );
    cloudAvailable = true;
    const recovered = await forwarder.drainOnce();
    expect(recovered.sent).toBe(backlogBefore);
    expect(recovered.backlog).toBe(0);
    expect(batches[1]!.events.map((event) => event.id)).toEqual(firstIds);
  });

  it('captures Cloud reconciliation conflicts without retrying the terminal event forever', async () => {
    await receipt(ledger, mainLocationId, beerSkuId, 10n, 'cloud-conflict');
    const transport: InventoryCloudTransport = {
      async send(batch) {
        return {
          acceptedIds: [],
          duplicateIds: [],
          conflictIds: batch.events.map((event) => event.id),
          serverTime: new Date().toISOString(),
        };
      },
    };
    const forwarder = new InventoryCloudForwarderService(database, transport);
    const before = await forwarder.backlogCount();
    const result = await forwarder.drainOnce();

    expect(result.sent).toBe(before);
    expect(result.backlog).toBe(0);
    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edge_inventory_exceptions
       WHERE exception_type = 'CLOUD_INVENTORY_RECONCILIATION_REQUIRED'`,
    );
    expect(Number(exceptions[0]!.count)).toBe(before);
  });
});
