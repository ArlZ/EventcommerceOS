import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { assertOrganisationAccess, type AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';

interface OrganisationRow extends QueryResultRow {
  organisation_id: string;
}

@Injectable()
export class HumanPaymentAuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async authorizePayment(context: AdminContext, paymentId: string): Promise<void> {
    const rows = await this.database.query<OrganisationRow>(
      `SELECT event.organisation_id::text
       FROM payments payment
       JOIN events event ON event.id::text=payment.event_id
       WHERE payment.id=$1`,
      [paymentId],
    );
    const row = rows[0];
    if (!row) throw new ForbiddenException('Payment is not available to this session');
    assertOrganisationAccess(context, row.organisation_id);
  }

  async authorizeAttempt(context: AdminContext, paymentAttemptId: string): Promise<void> {
    const rows = await this.database.query<OrganisationRow>(
      `SELECT event.organisation_id::text
       FROM payment_attempts attempt
       JOIN payments payment ON payment.id=attempt.payment_id
       JOIN events event ON event.id::text=payment.event_id
       WHERE attempt.id=$1`,
      [paymentAttemptId],
    );
    const row = rows[0];
    if (!row) throw new ForbiddenException('Payment attempt is not available to this session');
    assertOrganisationAccess(context, row.organisation_id);
  }

  async authorizeEvent(context: AdminContext, eventId: string): Promise<void> {
    const rows = await this.database.query<OrganisationRow>(
      'SELECT organisation_id::text FROM events WHERE id=$1',
      [eventId],
    );
    const row = rows[0];
    if (!row) throw new ForbiddenException('Event is not available to this session');
    assertOrganisationAccess(context, row.organisation_id);
  }

  assertActor(context: AdminContext, suppliedActorId: string, field: string): void {
    if (suppliedActorId !== context.actorId) {
      throw new ForbiddenException(`${field} must match the authenticated human actor`);
    }
  }
}
