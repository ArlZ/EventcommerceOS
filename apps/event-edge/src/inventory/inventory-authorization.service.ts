import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type InventoryPermission =
  | 'INVENTORY_MOVE'
  | 'TRANSFER_MANAGE'
  | 'COUNT_MANAGE'
  | 'ALERT_MANAGE'
  | 'INVENTORY_CONFIGURE';

@Injectable()
export class InventoryAuthorizationService {
  async require(
    client: PoolClient,
    eventId: string,
    actorId: string,
    permission: InventoryPermission,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM edge_inventory_actor_permissions
       WHERE event_id = $1 AND actor_id = $2 AND permission = $3`,
      [eventId, actorId, permission],
    );
    if (result.rowCount !== 1) {
      throw new ForbiddenException(`actor is not authorized for ${permission}`);
    }
  }
}
