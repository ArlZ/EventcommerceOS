import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface EventRow extends QueryResultRow {
  event_id: string;
}

@Injectable()
export class PaymentAccessService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async eventForPayment(paymentId: string): Promise<string> {
    const rows = await this.db.query<EventRow>('SELECT event_id::text FROM payments WHERE id=$1', [
      paymentId,
    ]);
    const eventId = rows[0]?.event_id;
    if (!eventId) throw new BadRequestException('Payment not found');
    return eventId;
  }

  async eventForAttempt(paymentAttemptId: string): Promise<string> {
    const rows = await this.db.query<EventRow>(
      `SELECT p.event_id::text
       FROM payment_attempts pa
       JOIN payments p ON p.id=pa.payment_id
       WHERE pa.id=$1`,
      [paymentAttemptId],
    );
    const eventId = rows[0]?.event_id;
    if (!eventId) throw new BadRequestException('Payment attempt not found');
    return eventId;
  }

  async eventForOrder(orderId: string): Promise<string> {
    const rows = await this.db.query<EventRow>(
      'SELECT DISTINCT event_id::text FROM payments WHERE order_id=$1',
      [orderId],
    );
    if (rows.length === 0) throw new BadRequestException('Order has no payments');
    if (rows.length !== 1) throw new BadRequestException('Order payment history spans multiple events');
    return rows[0]!.event_id;
  }
}
