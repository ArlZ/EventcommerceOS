import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedEdgePrincipal } from '@event-commerce/contracts';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class EdgeScopeService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  assertEvent(principal: AuthenticatedEdgePrincipal, eventId: string): void {
    if (principal.eventId !== eventId) {
      throw new ForbiddenException('Event Edge credential cannot act on another event');
    }
  }

  async assertPaymentAttempt(
    principal: AuthenticatedEdgePrincipal,
    paymentAttemptId: string,
  ): Promise<void> {
    const rows = await this.database.query<{ event_id: string }>(
      `SELECT payment.event_id
       FROM payment_attempts attempt
       JOIN payments payment ON payment.id=attempt.payment_id
       WHERE attempt.id=$1`,
      [paymentAttemptId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Payment attempt not found');
    this.assertEvent(principal, row.event_id);
  }
}
