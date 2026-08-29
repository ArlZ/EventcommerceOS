import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { EdgePosDeviceRosterEntry } from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';
import type { EdgeCloudIdentity } from './edge-cloud-auth.service';

@Injectable()
export class PosDeviceRosterService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(entries: EdgePosDeviceRosterEntry[], identity: EdgeCloudIdentity): Promise<void> {
    if (entries.length === 0) return;
    await this.database.transaction(async (client) => {
      for (const entry of entries) {
        const updated = await client.query<{ device_id: string }>(
          `INSERT INTO cloud_pos_device_roster(
             device_id,edge_id,organisation_id,event_id,sales_location_id,register_id,status,
             source_updated_at,cloud_received_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (device_id) DO UPDATE SET
             edge_id=EXCLUDED.edge_id,
             event_id=EXCLUDED.event_id,
             sales_location_id=EXCLUDED.sales_location_id,
             register_id=EXCLUDED.register_id,
             status=EXCLUDED.status,
             source_updated_at=EXCLUDED.source_updated_at,
             cloud_received_at=now()
           WHERE cloud_pos_device_roster.organisation_id=EXCLUDED.organisation_id
             AND cloud_pos_device_roster.source_updated_at <= EXCLUDED.source_updated_at
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
          const existing = await client.query<{ organisation_id: string; source_updated_at: Date }>(
            `SELECT organisation_id::text,source_updated_at
             FROM cloud_pos_device_roster WHERE device_id=$1`,
            [entry.deviceId],
          );
          if (existing.rows[0]?.organisation_id !== identity.organisationId) {
            throw new ConflictException(
              `device ${entry.deviceId} is already attributed to another organisation`,
            );
          }
          // An older replay is harmless; the newer roster assignment remains authoritative.
        }
      }
    });
  }
}
