import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { EdgeCloudAuthService, type EdgeCloudIdentity } from '../sync/edge-cloud-auth.service';

type HeadersRecord = Record<string, string | string[] | undefined>;

interface EventIdRow extends QueryResultRow {
  event_id: string;
}

@Injectable()
export class PaymentMachineAuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
  ) {}

  authenticate(headers: HeadersRecord): Promise<EdgeCloudIdentity> {
    return this.edgeAuth.authenticate(headers);
  }

  async authorizeInitiation(headers: HeadersRecord, eventId: string): Promise<EdgeCloudIdentity> {
    const identity = await this.authenticate(headers);
    await this.edgeAuth.authorizeEventIds(identity, [eventId]);
    return identity;
  }

  async authorizeAttempt(
    headers: HeadersRecord,
    paymentAttemptId: string,
  ): Promise<EdgeCloudIdentity> {
    const identity = await this.authenticate(headers);
    const rows = await this.database.query<EventIdRow>(
      `SELECT payment.event_id::text
       FROM payment_attempts attempt
       JOIN payments payment ON payment.id=attempt.payment_id
       JOIN events event ON event.id::text=payment.event_id
       WHERE attempt.id=$1 AND event.organisation_id=$2`,
      [paymentAttemptId, identity.organisationId],
    );
    if (rows.length !== 1) {
      throw new UnauthorizedException('Payment attempt is outside the Event Edge organisation');
    }
    return identity;
  }

  async authorizeOrder(headers: HeadersRecord, orderId: string): Promise<EdgeCloudIdentity> {
    const identity = await this.authenticate(headers);
    const rows = await this.database.query<EventIdRow>(
      `SELECT DISTINCT payment.event_id::text
       FROM payments payment
       JOIN events event ON event.id::text=payment.event_id
       WHERE payment.order_id=$1 AND event.organisation_id=$2`,
      [orderId, identity.organisationId],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException('Payment order is outside the Event Edge organisation');
    }
    if (rows.length > 1) {
      throw new UnauthorizedException('Payment order has conflicting event ownership');
    }
    return identity;
  }
}
