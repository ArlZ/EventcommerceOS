import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CommandCentreSnapshot } from '@event-commerce/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { CommandCentreDeviceRosterService } from '../src/command-centre/command-centre-device-roster.service';
import { DatabaseService } from '../src/database/database.service';
import { PosDeviceRosterService } from '../src/sync/pos-device-roster.service';
import { SyncDeviceHealthService } from '../src/sync/sync-device-health.service';
import {
  DEFAULT_SYNC_EVENT_ID,
  DEFAULT_SYNC_ORGANISATION_ID,
  provisionSyncEdge,
} from './sync-auth-testkit';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const edgeId = 'edge-roster-test';

function emptySnapshot(): CommandCentreSnapshot {
  return {
    event: {
      eventId: DEFAULT_SYNC_EVENT_ID,
      organisationId: DEFAULT_SYNC_ORGANISATION_ID,
      name: 'Roster test event',
      timezone: 'Africa/Nairobi',
      lifecycle: 'ACTIVE',
      startsAt: '2026-08-14T12:00:00.000Z',
      endsAt: '2026-08-15T12:00:00.000Z',
    },
    freshness: {
      generatedAt: '2026-08-14T13:00:00.000Z',
      staleAfterSeconds: 30,
      latestSourceAt: null,
    },
    sales: {
      transactionCount: 0,
      grossSales: [],
      averageOrderValue: [],
      currentSalesVelocity: [],
      lastSaleAt: null,
    },
    salesPulse: [],
    salesLocations: [],
    topProducts: [],
    payments: {
      settledMethods: [],
      attempts: {
        totalCount: 0,
        succeededCount: 0,
        pendingCount: 0,
        unknownCount: 0,
        failedCount: 0,
        successRate: 0,
        pendingRate: 0,
        unknownRate: 0,
        failureRate: 0,
        unknownValue: [],
      },
      rails: [],
    },
    inventory: { risks: [], activeTransfers: [] },
    devices: [],
    alerts: [],
  };
}

describeIntegration('Cloud POS device roster', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let roster: PosDeviceRosterService;
  let health: SyncDeviceHealthService;
  let commandCentreRoster: CommandCentreDeviceRosterService;

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    database = moduleRef.get(DatabaseService);
    roster = moduleRef.get(PosDeviceRosterService);
    health = moduleRef.get(SyncDeviceHealthService);
    commandCentreRoster = moduleRef.get(CommandCentreDeviceRosterService);
    await app.init();
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE cloud_pos_device_roster,sync_device_state,sync_order_state,sync_processed_events,
                edge_sync_client_audit,edge_sync_clients,sales_locations,events,organisations CASCADE`,
    );
    await provisionSyncEdge(database, { edgeId });
  });

  afterAll(async () => {
    delete process.env.PAYMENT_RECONCILIATION_DISABLED;
    await app.close();
  });

  it('shows a provisioned but never-seen active till as stale in both operational views', async () => {
    const updatedAt = '2026-08-14T12:30:00.000Z';
    await roster.ingest(
      [
        {
          deviceId: 'device-never-seen',
          eventId: DEFAULT_SYNC_EVENT_ID,
          salesLocationId: null,
          registerId: 'register-1',
          status: 'ACTIVE',
          updatedAt,
        },
      ],
      {
        edgeId,
        organisationId: DEFAULT_SYNC_ORGANISATION_ID,
        credentialVersion: 1,
      },
    );

    const syncHealth = await health.listForOrganisation(DEFAULT_SYNC_ORGANISATION_ID);
    expect(syncHealth).toEqual([
      expect.objectContaining({
        deviceId: 'device-never-seen',
        lastSeenAt: null,
        lastSequenceSeen: 0,
        edgeAcceptedThroughSequence: 0,
        edgeBacklogCount: 0,
        syncAgeSeconds: null,
        operationalStatus: 'STALE',
      }),
    ]);

    const commandCentre = await commandCentreRoster.enrich(DEFAULT_SYNC_EVENT_ID, emptySnapshot());
    expect(commandCentre.devices).toEqual([
      expect.objectContaining({
        deviceId: 'device-never-seen',
        lastSeenAt: null,
        status: 'STALE',
      }),
    ]);
    expect(commandCentre.salesLocations).toEqual([
      expect.objectContaining({
        salesLocationId: 'unassigned',
        tillsHealthy: 0,
        tillsTotal: 1,
        issueCount: 1,
      }),
    ]);
    expect(commandCentre.alerts).toEqual([
      expect.objectContaining({
        id: 'device:device-never-seen',
        severity: 'CRITICAL',
        title: 'device-never-seen has not reported yet',
        openedAt: updatedAt,
      }),
    ]);
  });

  it('removes a revoked till from active operational coverage', async () => {
    await roster.ingest(
      [
        {
          deviceId: 'device-revoked',
          eventId: DEFAULT_SYNC_EVENT_ID,
          salesLocationId: null,
          registerId: null,
          status: 'ACTIVE',
          updatedAt: '2026-08-14T12:30:00.000Z',
        },
      ],
      {
        edgeId,
        organisationId: DEFAULT_SYNC_ORGANISATION_ID,
        credentialVersion: 1,
      },
    );
    await roster.ingest(
      [
        {
          deviceId: 'device-revoked',
          eventId: DEFAULT_SYNC_EVENT_ID,
          salesLocationId: null,
          registerId: null,
          status: 'REVOKED',
          updatedAt: '2026-08-14T12:31:00.000Z',
        },
      ],
      {
        edgeId,
        organisationId: DEFAULT_SYNC_ORGANISATION_ID,
        credentialVersion: 1,
      },
    );

    expect(await health.listForOrganisation(DEFAULT_SYNC_ORGANISATION_ID)).toEqual([]);
    const commandCentre = await commandCentreRoster.enrich(DEFAULT_SYNC_EVENT_ID, emptySnapshot());
    expect(commandCentre.devices).toEqual([]);
    expect(commandCentre.alerts).toEqual([]);
  });
});
