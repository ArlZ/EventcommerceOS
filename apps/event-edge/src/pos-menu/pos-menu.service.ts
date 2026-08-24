import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';
import type { PosMenuSnapshot } from './pos-menu.types';

interface SnapshotRow extends QueryResultRow {
  version: string;
  checksum: string;
  payload: PosMenuSnapshot;
}

@Injectable()
export class PosMenuService {
  constructor(@Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService) {}

  async install(snapshot: PosMenuSnapshot): Promise<PosMenuSnapshot> {
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `pos-menu:${snapshot.eventId}:${snapshot.salesLocationId}`,
      ]);
      const existingResult = await client.query<SnapshotRow>(
        `SELECT version::text,checksum,payload
         FROM edge_pos_menu_snapshots
         WHERE event_id=$1 AND sales_location_id=$2
         FOR UPDATE`,
        [snapshot.eventId, snapshot.salesLocationId],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const existingVersion = BigInt(existing.version);
        const candidateVersion = BigInt(snapshot.version);
        if (candidateVersion < existingVersion) {
          throw new ConflictException('menu snapshot version must advance monotonically');
        }
        if (candidateVersion === existingVersion) {
          if (existing.checksum !== snapshot.checksum) {
            throw new ConflictException(
              'menu snapshot version already exists with different content',
            );
          }
          return existing.payload;
        }
      }

      const installed = await client.query<SnapshotRow>(
        `INSERT INTO edge_pos_menu_snapshots(
           event_id,sales_location_id,menu_id,version,activated_at_epoch_ms,
           source_actor,currency,checksum,payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (event_id,sales_location_id) DO UPDATE SET
           menu_id=EXCLUDED.menu_id,
           version=EXCLUDED.version,
           activated_at_epoch_ms=EXCLUDED.activated_at_epoch_ms,
           source_actor=EXCLUDED.source_actor,
           currency=EXCLUDED.currency,
           checksum=EXCLUDED.checksum,
           payload=EXCLUDED.payload,
           updated_at=now()
         RETURNING version::text,checksum,payload`,
        [
          snapshot.eventId,
          snapshot.salesLocationId,
          snapshot.menuId,
          snapshot.version,
          snapshot.activatedAtEpochMs,
          snapshot.sourceActor,
          snapshot.currency,
          snapshot.checksum,
          JSON.stringify(snapshot),
        ],
      );
      return installed.rows[0]!.payload;
    });
  }

  async current(eventId: string, salesLocationId: string): Promise<PosMenuSnapshot> {
    const rows = await this.database.query<SnapshotRow>(
      `SELECT version::text,checksum,payload
       FROM edge_pos_menu_snapshots
       WHERE event_id=$1 AND sales_location_id=$2`,
      [eventId, salesLocationId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('no POS menu snapshot is installed for this sales location');
    }
    return row.payload;
  }
}
