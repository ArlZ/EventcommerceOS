import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DeviceSyncBatch, InitiatePaymentRequest } from '@event-commerce/contracts';
import type { QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';

export interface PosDeviceIdentity {
  deviceId: string;
  eventId: string;
  salesLocationId: string | null;
  registerId: string | null;
  credentialVersion: number;
}

interface DeviceRow extends QueryResultRow {
  device_id: string;
  credential_sha256: string;
  credential_version: number;
  status: 'ACTIVE' | 'REVOKED';
  event_id: string;
  sales_location_id: string | null;
  register_id: string | null;
}

interface EventOwnerRow extends QueryResultRow {
  event_id: string;
}

type HeadersRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function deviceIdHeader(headers: HeadersRecord): string {
  const value = first(headers['x-device-id'])?.trim();
  if (!value || value.length > 200) {
    throw new UnauthorizedException('x-device-id is required');
  }
  return value;
}

function bearer(headers: HeadersRecord): string {
  const authorization = first(headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedException('POS device bearer credential required');
  }
  const value = authorization.slice('Bearer '.length).trim();
  if (value.length < 32 || value.length > 512) {
    throw new UnauthorizedException('POS device bearer credential is invalid');
  }
  return value;
}

function hashCredential(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class DeviceEdgeAuthService {
  constructor(@Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService) {}

  async authenticate(headers: HeadersRecord): Promise<PosDeviceIdentity> {
    const deviceId = deviceIdHeader(headers);
    const token = bearer(headers);
    const rows = await this.database.query<DeviceRow>(
      `SELECT device_id,credential_sha256,credential_version,status,event_id,
              sales_location_id,register_id
       FROM edge_pos_devices WHERE device_id=$1`,
      [deviceId],
    );
    const row = rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('POS device credential is not active');
    }

    const actual = hashCredential(token);
    const expected = Buffer.from(row.credential_sha256, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('POS device credential is invalid');
    }

    await this.database.query(
      `UPDATE edge_pos_devices SET last_authenticated_at=now()
       WHERE device_id=$1 AND credential_version=$2 AND status='ACTIVE'`,
      [row.device_id, row.credential_version],
    );

    return {
      deviceId: row.device_id,
      eventId: row.event_id,
      salesLocationId: row.sales_location_id,
      registerId: row.register_id,
      credentialVersion: row.credential_version,
    };
  }

  authorizeSyncBatch(identity: PosDeviceIdentity, batch: DeviceSyncBatch): void {
    if (batch.deviceId !== identity.deviceId) {
      throw new UnauthorizedException('sync batch deviceId does not match authenticated POS device');
    }
    for (const event of batch.events) {
      if (event.deviceId !== identity.deviceId) {
        throw new UnauthorizedException('sync event deviceId does not match authenticated POS device');
      }
      const eventId = event.payload.eventId;
      if (typeof eventId !== 'string' || eventId.trim() !== identity.eventId) {
        throw new UnauthorizedException('sync event is outside the POS device event assignment');
      }
      if (identity.salesLocationId !== null) {
        const salesLocationId = event.payload.salesLocationId;
        if (
          salesLocationId !== undefined &&
          salesLocationId !== null &&
          (typeof salesLocationId !== 'string' || salesLocationId.trim() !== identity.salesLocationId)
        ) {
          throw new UnauthorizedException(
            'sync event is outside the POS device sales-location assignment',
          );
        }
      }
    }
  }

  authorizePaymentInitiation(identity: PosDeviceIdentity, request: InitiatePaymentRequest): void {
    if (request.eventId !== identity.eventId) {
      throw new UnauthorizedException('payment is outside the POS device event assignment');
    }
  }

  async authorizePaymentAttempt(identity: PosDeviceIdentity, paymentAttemptId: string): Promise<void> {
    const rows = await this.database.query<EventOwnerRow>(
      `SELECT event_id FROM edge_payment_attempt_cache WHERE payment_attempt_id=$1`,
      [paymentAttemptId],
    );
    const eventId = rows[0]?.event_id;
    if (!eventId) throw new BadRequestException('payment attempt is not cached at Event Edge');
    if (eventId !== identity.eventId) {
      throw new UnauthorizedException('payment attempt is outside the POS device event assignment');
    }
  }

  async authorizeOrder(identity: PosDeviceIdentity, orderId: string): Promise<void> {
    const rows = await this.database.query<EventOwnerRow>(
      `SELECT DISTINCT event_id FROM edge_payment_attempt_cache WHERE order_id=$1`,
      [orderId],
    );
    if (rows.length === 0) throw new BadRequestException('order has no cached Edge payment attempts');
    if (rows.some((row) => row.event_id !== identity.eventId)) {
      throw new UnauthorizedException('order is outside the POS device event assignment');
    }
  }
}
