import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { EdgeCloudBatch } from '@event-commerce/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { EdgeDatabaseService } from '../src/database/database.service';
import { CloudForwarderService } from '../src/sync/cloud-forwarder.service';
import { CloudSyncTransport } from '../src/sync/cloud-sync.transport';
import { provisionPosDevice, revokePosDevice } from './pos-device-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('POS device roster Cloud sync', () => {
  let app: INestApplication;
  let database: EdgeDatabaseService;
  let forwarder: CloudForwarderService;
  const sentBatches: EdgeCloudBatch[] = [];
  const transport: CloudSyncTransport = {
    async send(batch) {
      sentBatches.push(batch);
      return {
        acceptedEventInstanceIds: batch.events.map((event) => event.eventInstanceId),
        duplicateEventInstanceIds: [],
        conflictEventInstanceIds: [],
        serverTime: new Date().toISOString(),
      };
    },
  };

  beforeAll(async () => {
    process.env.EDGE_FORWARDER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CloudSyncTransport)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(EdgeDatabaseService);
    forwarder = moduleRef.get(CloudForwarderService);
    await app.init();
  });

  beforeEach(async () => {
    sentBatches.length = 0;
    await database.query(
      `TRUNCATE edge_payment_attempt_cache,edge_cloud_outbox,edge_processed_device_events,
                edge_device_watermarks,edge_reconciliation_exceptions,
                edge_pos_device_audit,edge_pos_devices,
                edge_sales_inventory_mapping,edge_inventory_locations,edge_inventory_event_config
       CASCADE`,
    );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDGE_FORWARDER_DISABLED;
  });

  it('sends a provisioned but never-seen till in a roster-only heartbeat', async () => {
    await provisionPosDevice(database, 'device-never-seen', {
      salesLocationId: 'bar-quiet',
      registerId: 'register-quiet-1',
    });

    await (
      forwarder as unknown as { syncRosterOnce(): Promise<void> }
    ).syncRosterOnce();

    expect(sentBatches).toHaveLength(1);
    expect(sentBatches[0]!.events).toEqual([]);
    expect(sentBatches[0]!.deviceStatuses).toEqual([]);
    expect(sentBatches[0]!.deviceRoster).toEqual([
      expect.objectContaining({
        deviceId: 'device-never-seen',
        salesLocationId: 'bar-quiet',
        registerId: 'register-quiet-1',
        status: 'ACTIVE',
      }),
    ]);
  });

  it('propagates revocation without requiring a sale event', async () => {
    await provisionPosDevice(database, 'device-revoked');
    await revokePosDevice(database, 'device-revoked');

    await (
      forwarder as unknown as { syncRosterOnce(): Promise<void> }
    ).syncRosterOnce();

    expect(sentBatches[0]!.deviceRoster).toEqual([
      expect.objectContaining({ deviceId: 'device-revoked', status: 'REVOKED' }),
    ]);
  });
});
