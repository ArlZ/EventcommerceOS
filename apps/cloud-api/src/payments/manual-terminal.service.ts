import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  ConfirmExternalTerminalPaymentRequest,
  ExternalTerminalConfirmationView,
} from '@event-commerce/contracts';
import { assertPaymentAttemptTransition, type PaymentAttemptState } from '@event-commerce/domain';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface AttemptRow extends QueryResultRow {
  id: string;
  payment_id: string;
  event_id: string;
  order_id: string;
  provider_id: string;
  amount_minor: string;
  currency: string;
  status: PaymentAttemptState;
  provider_reference: string | null;
}

interface ConfirmationRow extends QueryResultRow {
  id: string;
  payment_attempt_id: string;
  event_id: string;
  order_id: string;
  external_provider_id: string;
  external_reference: string;
  amount_minor: string;
  currency: string;
  outcome: 'APPROVED' | 'DECLINED';
  actor_id: string;
  reason: string;
  idempotency_key: string;
  created_at: Date | string;
}

function toView(row: ConfirmationRow): ExternalTerminalConfirmationView {
  return {
    confirmationId: row.id,
    paymentAttemptId: row.payment_attempt_id,
    eventId: row.event_id,
    orderId: row.order_id,
    externalProviderId: row.external_provider_id,
    externalReference: row.external_reference,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    outcome: row.outcome,
    actorId: row.actor_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class ManualTerminalService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async confirm(
    request: ConfirmExternalTerminalPaymentRequest,
  ): Promise<ExternalTerminalConfirmationView> {
    return this.db.transaction(async (client) => {
      const attemptResult = await client.query<AttemptRow>(
        `SELECT pa.id,pa.payment_id,p.event_id,p.order_id,pa.provider_id,
                p.amount_minor::text,p.currency,pa.status,pa.provider_reference
         FROM payment_attempts pa
         JOIN payments p ON p.id=pa.payment_id
         WHERE pa.id=$1
         FOR UPDATE`,
        [request.paymentAttemptId],
      );
      const attempt = attemptResult.rows[0];
      if (!attempt) throw new Error('Payment attempt not found');

      const dedicatedExternal = attempt.provider_id === 'external_terminal';
      const supervisedSabiDecline =
        attempt.provider_id === 'pesapal_sabi' &&
        request.outcome === 'DECLINED' &&
        attempt.provider_reference === null;
      if (!dedicatedExternal && !supervisedSabiDecline) {
        throw new Error(
          'Manual approval requires an external_terminal attempt; integrated Sabi only permits a supervised reference-less DECLINED record',
        );
      }

      await this.requirePermission(client, attempt.event_id, request.actorId);

      const existing = await client.query<ConfirmationRow>(
        `${this.selectConfirmation()} WHERE idempotency_key=$1 FOR UPDATE`,
        [request.idempotencyKey],
      );
      if (existing.rows[0]) {
        this.assertSame(existing.rows[0], request);
        return toView(existing.rows[0]);
      }

      if (Number(attempt.amount_minor) !== request.amountMinor || attempt.currency !== request.currency) {
        throw new Error('Manual terminal confirmation amount/currency must match the payment attempt');
      }
      if (attempt.status === 'UNKNOWN') {
        throw new Error('Unknown payment truth must be reconciled before manual terminal fallback');
      }
      if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') {
        throw new Error('Payment attempt is already terminal');
      }

      const target: PaymentAttemptState = request.outcome === 'APPROVED' ? 'SUCCEEDED' : 'FAILED';
      assertPaymentAttemptTransition(attempt.status, target);

      const inserted = await client.query<ConfirmationRow>(
        `INSERT INTO payment_manual_terminal_confirmations(
           id,payment_attempt_id,event_id,order_id,external_provider_id,external_reference,
           amount_minor,currency,outcome,actor_id,reason,idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id,payment_attempt_id,event_id,order_id,external_provider_id,external_reference,
                   amount_minor::text,currency,outcome,actor_id,reason,idempotency_key,created_at`,
        [
          request.confirmationId,
          attempt.id,
          attempt.event_id,
          attempt.order_id,
          request.externalProviderId,
          request.externalReference,
          request.amountMinor,
          request.currency,
          request.outcome,
          request.actorId,
          request.reason,
          request.idempotencyKey,
        ],
      );
      const confirmation = inserted.rows[0]!;

      await client.query(
        `UPDATE payment_attempts
         SET status=$2,
             provider_reference=CASE WHEN provider_id='external_terminal' THEN $3 ELSE provider_reference END,
             failure_code=$4,
             resolved_at=now(),updated_at=now()
         WHERE id=$1`,
        [
          attempt.id,
          target,
          request.externalReference,
          request.outcome === 'DECLINED'
            ? supervisedSabiDecline
              ? 'SABI_TERMINAL_DECLINED_MANUAL_EVIDENCE'
              : 'EXTERNAL_TERMINAL_DECLINED'
            : null,
        ],
      );
      await client.query(
        `INSERT INTO payment_reconciliation_jobs(payment_attempt_id,status,last_error_code)
         VALUES ($1,'RESOLVED',NULL)
         ON CONFLICT (payment_attempt_id) DO UPDATE
         SET status='RESOLVED',last_error_code=NULL,updated_at=now()`,
        [attempt.id],
      );
      await client.query(
        `INSERT INTO payment_audit_events(
           event_id,actor_id,action,aggregate_type,aggregate_id,payload
         ) VALUES ($1,$2,'PAYMENT_MANUAL_TERMINAL_CONFIRMED','PAYMENT_ATTEMPT',$3,$4::jsonb)`,
        [
          attempt.event_id,
          request.actorId,
          attempt.id,
          JSON.stringify({
            confirmationId: request.confirmationId,
            paymentProviderId: attempt.provider_id,
            externalProviderId: request.externalProviderId,
            externalReference: request.externalReference,
            amountMinor: request.amountMinor,
            currency: request.currency,
            outcome: request.outcome,
            reason: request.reason,
          }),
        ],
      );

      return toView(confirmation);
    });
  }

  async history(paymentId: string): Promise<ExternalTerminalConfirmationView[]> {
    const rows = await this.db.query<ConfirmationRow>(
      `SELECT c.id,c.payment_attempt_id,c.event_id,c.order_id,c.external_provider_id,
              c.external_reference,c.amount_minor::text,c.currency,c.outcome,c.actor_id,c.reason,
              c.idempotency_key,c.created_at
       FROM payment_manual_terminal_confirmations c
       JOIN payment_attempts pa ON pa.id=c.payment_attempt_id
       WHERE pa.payment_id=$1
       ORDER BY c.created_at`,
      [paymentId],
    );
    return rows.map(toView);
  }

  private async requirePermission(client: PoolClient, eventId: string, actorId: string): Promise<void> {
    const allowed = await client.query(
      `SELECT 1 FROM payment_actor_permissions
       WHERE event_id=$1 AND actor_id=$2 AND permission='PAYMENT_MANUAL_CONFIRM'`,
      [eventId, actorId],
    );
    if (allowed.rowCount !== 1) {
      throw new ForbiddenException('actor is not authorized for PAYMENT_MANUAL_CONFIRM');
    }
  }

  private assertSame(
    existing: ConfirmationRow,
    request: ConfirmExternalTerminalPaymentRequest,
  ): void {
    if (
      existing.id !== request.confirmationId ||
      existing.payment_attempt_id !== request.paymentAttemptId ||
      existing.external_provider_id !== request.externalProviderId ||
      existing.external_reference !== request.externalReference ||
      Number(existing.amount_minor) !== request.amountMinor ||
      existing.currency !== request.currency ||
      existing.outcome !== request.outcome ||
      existing.actor_id !== request.actorId ||
      existing.reason !== request.reason
    ) {
      throw new Error('Manual terminal idempotency key was reused for a different confirmation');
    }
  }

  private selectConfirmation(): string {
    return `SELECT id,payment_attempt_id,event_id,order_id,external_provider_id,external_reference,
                   amount_minor::text,currency,outcome,actor_id,reason,idempotency_key,created_at
            FROM payment_manual_terminal_confirmations`;
  }
}
