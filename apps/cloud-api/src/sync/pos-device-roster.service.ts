import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { EdgePosDeviceRosterEntry } from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';
import type { EdgeCloudIdentity } from './edge-cloud-auth.service';

interface IdentityClaimRow {
  device_id: string;
  organisation_id: string | null;
  edge_id: string | null;
}

interface ExistingRosterRow {
  organisation_id: string;
  edge_id: string;
  source_updated_at: Date;
}

@Injectable()
export class PosDeviceRosterService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(entries: EdgePosDeviceRosterEntry[], identity: EdgeCloudIdentity): Promise<void> {
    if (entries.length === 0) return;
    await this.database.transaction(async (client) => {
      const deviceIds = [...new Set(entries.map((entry) => entry.deviceId))].sort();
      for (const deviceId of deviceIds) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `sync-device-identity:${deviceId}`,
        ]);
      }

      const rosterClaims = await client.query<IdentityClaimRow>(
        `SELECT device_id,organisation_id::text,edge_id
         FROM cloud_pos_device_roster
         WHERE device_id = ANY($1::text[])`,
        [deviceIds],
      );
      const rosterCollision = rosterClaims.rows.find(
        (row) => row.organisation_id !== identity.organisationId || row.edge_id !== identity.edgeId,
      );
      if (rosterCollision) {
        throw new ConflictException(
          `device ${rosterCollision.device_id} is already attributed to another Event Edge scope`,
        );
      }

      const stateClaims = await client.query<IdentityClaimRow>(
        `SELECT device_id,organisation_id::text,edge_id
         FROM sync_device_state
         WHERE device_id = ANY($1::text[])`,
        [deviceIds],
      );
      const stateCollision = stateClaims.rows.find(
        (row) =>
          (row.organisation_id !== null && row.organisation_id !== identity.organisationId) ||
          (row.edge_id !== null && row.edge_id !== identity.edgeId),
      );
      if (stateCollision) {
        throw new ConflictException(
          `device ${stateCollision.device_id} already has telemetry from another Event Edge scope`,
        );
      }

      const processedClaims = await client.query<IdentityClaimRow>(
        `SELECT DISTINCT device_id,organisation_id::text,edge_id
         FROM sync_processed_events
         WHERE organisation_id=$1
           AND device_id = ANY($2::text[])
           AND edge_id IS NOT NULL`,
        [identity.organisationId, deviceIds],
      );
      const processedCollision = processedClaims.rows.find(
        (row) => row.edge_id !== identity.edgeId,
      );
      if (processedCollision) {
        throw new ConflictException(
          `device ${processedCollision.device_id} already has events from another Event Edge scope`,
        );
      }

      for (const entry of entries) {
        const updated = await client.query<{ device_id: string }>(
          `INSERT INTO cloud_pos_device_roster(
             device_id,edge_id,organisation_id,event_id,sales_location_id,register_id,status,
             source_updated_at,cloud_received_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (device_id) DO UPDATE SET
             event_id=EXCLUDED.event_id,
             sales_location_id=EXCLUDED.sales_location_id,
             register_id=EXCLUDED.register_id,
             status=EXCLUDED.status,
             source_updated_at=EXCLUDED.source_updated_at,
             cloud_received_at=now()
           WHERE cloud_pos_device_roster.organisation_id=EXCLUDED.organisation_id
             AND cloud_pos_device_roster.edge_id=EXCLUDED.edge_id
             AND cloud_pos_device_roster.source_updated_at < EXCLUDED.source_updated_at
           RETURNING device_id`,
          [
            entry.deviceId,
            identity.edgeId,
            identity.organisationId,
            entry.eventId,
            entry.salesLocationId,
            entry.registerId,
            entry.status,
            entry.updatedAt,
          ],
        );
        if (updated.rowCount === 0) {
          const existing = await client.query<ExistingRosterRow>(
            `SELECT organisation_id::text,edge_id,source_updated_at
             FROM cloud_pos_device_roster WHERE device_id=$1`,
            [entry.deviceId],
          );
          const current = existing.rows[0];
          if (
            current &&
            (current.organisation_id !== identity.organisationId ||
              current.edge_id !== identity.edgeId)
          ) {
            throw new ConflictException(
              `device ${entry.deviceId} is already attributed to another Event Edge scope`,
            );
          }
          // Same or older roster replay is harmless; newer configuration remains authoritative.
        }
      }
    });
  }
}
