import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  PaymentAttemptSnapshot,
} from '@event-commerce/contracts';
import {
  paymentRetryDisposition,
  providerOutcomeToAttemptState,
  requirePaymentAttemptTransition,
  requiresPaymentReconciliation,
  type PaymentAttemptState,
} from '@event-commerce/domain';
import { DatabaseService } from '../database/database.service';
import { maskMsisdn } from './payment-validation';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderInitiationResult,
  type ProviderQueryResult,
} from './payment-provider';

interface AttemptRow extends QueryResultRow {
  id: string;
  payment_id: string;
  client_attempt_id: string;
  provider: string;
  amount_minor: string;
  currency: string;
  masked_payer_reference: string | null;
  initiation_idempotency_key: string;
  dispatch_started_at: Date | null;
  provider_request_id: string | null;
  provider_receipt_reference: string | null;
  created_at: Date;
  state: PaymentAttemptState;
  reconciliation_required: boolean;
  next_query_at: Date | null;
  updated_at: Date;
  event_id: string;
  order_id: string;
}

interface PaymentRow extends QueryResultRow {
  id: string;
  event_id: string;
  order_id: string;
  amount_minor: string;
  currency: string;
}

interface CreateAttemptResult {
  attempt: AttemptRow;
  idempotentReplay: boolean;
}

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async initiate(input: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const created = await this.createOrFindAttempt(input);

    if (created.idempotentReplay) {
      if (created.attempt.dispatch_started_at !== null && created.attempt.state === 'INITIATED') {
        await this.applyTransition(created.attempt.id, {
          target: 'UNKNOWN',
          source: 'SYSTEM',
          sourceId: 'replay-after-provider-dispatch',
          reasonCode: 'DISPATCH_RESULT_NOT_DURABLE',
          providerRequestId: created.attempt.provider_request_id,
          providerReceiptReference: created.attempt.provider_receipt_reference,
        });
      }
      return {
        attempt: await this.snapshot(created.attempt.id),
        idempotentReplay: true,
      };
    }

    const shouldDispatch = await this.beginProviderDispatch(created.attempt.id);
    if (!shouldDispatch) {
      return {
        attempt: await this.snapshot(created.attempt.id),
        idempotentReplay: true,
      };
    }

    let result: ProviderInitiationResult;
    try {
      result = await this.provider.initiate({
        attemptId: created.attempt.id,
        amountMinor: input.amountMinor,
        currency: input.currency,
        accountReference: input.orderId,
        payer: input.payer,
      });
    } catch {
      await this.applyTransition(created.attempt.id, {
        target: 'UNKNOWN',
        source: 'PROVIDER_INITIATION',
        sourceId: `transport:${created.attempt.id}`,
        reasonCode: 'PROVIDER_TRANSPORT_AMBIGUOUS',
        providerRequestId: null,
        providerReceiptReference: null,
      });
      return {
        attempt: await this.snapshot(created.attempt.id),
        idempotentReplay: created.idempotentReplay,
      };
    }

    await this.applyProviderInitiationResult(created.attempt.id, result);
    return {
      attempt: await this.snapshot(created.attempt.id),
      idempotentReplay: created.idempotentReplay,
    };
  }

  async getAttempt(attemptId: string): Promise<PaymentAttemptSnapshot> {
    return this.snapshot(attemptId);
  }

  async reconcileAttempt(attemptId: string, sourceId = `query:${randomUUID()}`): Promise<void> {
    const current = await this.attempt(attemptId);
    if (!requiresPaymentReconciliation(current.state)) return;
    if (!current.provider_request_id || !this.provider.capabilities().queryStatus) return;

    let result: ProviderQueryResult;
    try {
      result = await this.provider.queryStatus({
        attemptId,
        providerRequestId: current.provider_request_id,
      });
    } catch {
      await this.scheduleQueryFailure(attemptId, 'PROVIDER_QUERY_TRANSPORT_ERROR');
      return;
    }

    await this.applyTransition(attemptId, {
      target: providerOutcomeToAttemptState(result.outcome),
      source: 'PROVIDER_QUERY',
      sourceId,
      reasonCode: result.reasonCode,
      providerRequestId: result.providerRequestId,
      providerReceiptReference: result.providerReceiptReference,
    });
  }

  private async createOrFindAttempt(input: InitiatePaymentRequest): Promise<CreateAttemptResult> {
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `payment-initiation:${input.idempotencyKey}`,
      ]);

      const existing = await this.attemptByIdempotency(client, input.idempotencyKey);
      if (existing) return { attempt: existing, idempotentReplay: true };

      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `payment:${input.paymentId}`,
      ]);
      await this.ensurePayment(client, input);
      const prior = await client.query<{ state: PaymentAttemptState }>(
        `SELECT s.state
         FROM payment_attempts a
         JOIN payment_attempt_state s ON s.attempt_id = a.id
         WHERE a.payment_id = $1`,
        [input.paymentId],
      );
      const disposition = paymentRetryDisposition(prior.rows.map((row) => row.state));
      if (disposition === 'BLOCK_UNRESOLVED') {
        throw new ConflictException(
          'payment has an unresolved attempt; reconcile it before retrying',
        );
      }
      if (disposition === 'BLOCK_SETTLED') {
        throw new ConflictException('payment is already settled');
      }

      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO payment_attempts(
           id, payment_id, client_attempt_id, provider, amount_minor, currency,
           masked_payer_reference, initiation_idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          attemptId,
          input.paymentId,
          input.clientAttemptId,
          input.provider,
          input.amountMinor,
          input.currency,
          maskMsisdn(input.payer.value),
          input.idempotencyKey,
        ],
      );
      await client.query(
        `INSERT INTO payment_attempt_state(
           attempt_id, state, reconciliation_required, updated_at
         ) VALUES ($1,'INITIATED',true,clock_timestamp())`,
        [attemptId],
      );
      await client.query(
        `INSERT INTO payment_attempt_transitions(
           id, attempt_id, from_state, to_state, source, source_id, reason_code, occurred_at
         ) VALUES ($1,$2,NULL,'INITIATED','CLIENT',$3,'PAYMENT_REQUESTED',clock_timestamp())`,
        [randomUUID(), attemptId, input.idempotencyKey],
      );
      return {
        attempt: await this.attemptWithClient(client, attemptId),
        idempotentReplay: false,
      };
    });
  }

  private async ensurePayment(client: PoolClient, input: InitiatePaymentRequest): Promise<void> {
    const existing = await client.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [
      input.paymentId,
    ]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (
        row.event_id !== input.eventId ||
        row.order_id !== input.orderId ||
        row.amount_minor !== input.amountMinor.toString() ||
        row.currency !== input.currency
      ) {
        throw new ConflictException('payment ID was reused with different financial content');
      }
      return;
    }
    await client.query(
      `INSERT INTO payments(id, event_id, order_id, amount_minor, currency)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.paymentId, input.eventId, input.orderId, input.amountMinor, input.currency],
    );
  }

  private async beginProviderDispatch(attemptId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `payment-dispatch:${attemptId}`,
      ]);
      const row = await this.attemptWithClient(client, attemptId);
      if (row.dispatch_started_at !== null || row.state !== 'INITIATED') return false;
      const updated = await client.query(
        `UPDATE payment_attempts SET dispatch_started_at = clock_timestamp()
         WHERE id = $1 AND dispatch_started_at IS NULL
         RETURNING id`,
        [attemptId],
      );
      return updated.rowCount === 1;
    });
  }

  private async applyProviderInitiationResult(
    attemptId: string,
    result: ProviderInitiationResult,
  ): Promise<void> {
    await this.applyTransition(attemptId, {
      target: providerOutcomeToAttemptState(result.outcome),
      source: 'PROVIDER_INITIATION',
      sourceId: result.providerRequestId ?? `initiation:${attemptId}`,
      reasonCode: result.reasonCode,
      providerRequestId: result.providerRequestId,
      providerReceiptReference: result.providerReceiptReference,
    });
  }

  private async applyTransition(
    attemptId: string,
    input: {
      target: PaymentAttemptState;
      source: string;
      sourceId: string;
      reasonCode: string | null;
      providerRequestId: string | null;
      providerReceiptReference: string | null;
    },
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const duplicate = await client.query(
        `SELECT 1 FROM payment_attempt_transitions
         WHERE attempt_id = $1 AND source = $2 AND source_id = $3`,
        [attemptId, input.source, input.sourceId],
      );
      if (duplicate.rowCount === 1) return;

      const attempt = await this.attemptWithClient(client, attemptId, true);
      try {
        requirePaymentAttemptTransition(attempt.state, input.target);
      } catch {
        await this.exception(client, attemptId, attempt.provider, 'CONFLICTING_PROVIDER_TRUTH', {
          currentState: attempt.state,
          observedState: input.target,
          source: input.source,
          reasonCode: input.reasonCode,
        });
        return;
      }

      if (input.providerRequestId && attempt.provider_request_id !== input.providerRequestId) {
        if (attempt.provider_request_id !== null) {
          await this.exception(
            client,
            attemptId,
            attempt.provider,
            'PROVIDER_REQUEST_ID_CONFLICT',
            {
              currentRequestId: attempt.provider_request_id,
              observedRequestId: input.providerRequestId,
            },
          );
          return;
        }
        await client.query(`UPDATE payment_attempts SET provider_request_id = $2 WHERE id = $1`, [
          attemptId,
          input.providerRequestId,
        ]);
      }
      if (input.providerReceiptReference && attempt.provider_receipt_reference === null) {
        await client.query(
          `UPDATE payment_attempts SET provider_receipt_reference = $2 WHERE id = $1`,
          [attemptId, input.providerReceiptReference],
        );
      }

      const reconciliationRequired = requiresPaymentReconciliation(input.target);
      const nextQueryAt =
        reconciliationRequired && (input.providerRequestId ?? attempt.provider_request_id)
          ? new Date(Date.now() + 5_000).toISOString()
          : null;
      await client.query(
        `UPDATE payment_attempt_state SET
           state = $2,
           reconciliation_required = $3,
           next_query_at = $4,
           last_provider_error_code = $5,
           terminal_at = CASE WHEN $3 THEN NULL ELSE COALESCE(terminal_at, clock_timestamp()) END,
           updated_at = clock_timestamp()
         WHERE attempt_id = $1`,
        [attemptId, input.target, reconciliationRequired, nextQueryAt, input.reasonCode],
      );
      await client.query(
        `INSERT INTO payment_attempt_transitions(
           id, attempt_id, from_state, to_state, source, source_id, reason_code, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
        [
          randomUUID(),
          attemptId,
          attempt.state,
          input.target,
          input.source,
          input.sourceId,
          input.reasonCode,
        ],
      );
    });
  }

  private async scheduleQueryFailure(attemptId: string, reasonCode: string): Promise<void> {
    await this.database.query(
      `UPDATE payment_attempt_state SET
         query_attempts = query_attempts + 1,
         next_query_at = clock_timestamp() + make_interval(secs => LEAST(60, (2 ^ LEAST(query_attempts + 1, 6))::integer)),
         last_provider_error_code = $2,
         updated_at = clock_timestamp()
       WHERE attempt_id = $1 AND reconciliation_required = true`,
      [attemptId, reasonCode],
    );
  }

  private async attempt(attemptId: string): Promise<AttemptRow> {
    const rows = await this.database.query<AttemptRow>(this.attemptSql(false), [attemptId]);
    const row = rows[0];
    if (!row) throw new NotFoundException('payment attempt not found');
    return row;
  }

  private async attemptWithClient(
    client: PoolClient,
    attemptId: string,
    lock = false,
  ): Promise<AttemptRow> {
    const result = await client.query<AttemptRow>(this.attemptSql(lock), [attemptId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('payment attempt not found');
    return row;
  }

  private async attemptByIdempotency(
    client: PoolClient,
    idempotencyKey: string,
  ): Promise<AttemptRow | null> {
    const result = await client.query<AttemptRow>(
      `${this.attemptSql(false).replace('WHERE a.id = $1', 'WHERE a.initiation_idempotency_key = $1')}`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  private attemptSql(lock: boolean): string {
    return `SELECT a.id, a.payment_id, a.client_attempt_id, a.provider,
                   a.amount_minor::text, a.currency, a.masked_payer_reference,
                   a.initiation_idempotency_key, a.dispatch_started_at,
                   a.provider_request_id, a.provider_receipt_reference, a.created_at,
                   s.state, s.reconciliation_required, s.next_query_at, s.updated_at,
                   p.event_id, p.order_id
            FROM payment_attempts a
            JOIN payment_attempt_state s ON s.attempt_id = a.id
            JOIN payments p ON p.id = a.payment_id
            WHERE a.id = $1${lock ? ' FOR UPDATE OF a, s' : ''}`;
  }

  private async snapshot(attemptId: string): Promise<PaymentAttemptSnapshot> {
    return this.toSnapshot(await this.attempt(attemptId));
  }

  private toSnapshot(row: AttemptRow): PaymentAttemptSnapshot {
    return {
      paymentId: row.payment_id,
      attemptId: row.id,
      clientAttemptId: row.client_attempt_id,
      eventId: row.event_id,
      orderId: row.order_id,
      provider: 'MPESA',
      state: row.state,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      maskedPayerReference: row.masked_payer_reference,
      providerRequestId: row.provider_request_id,
      providerReceiptReference: row.provider_receipt_reference,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      reconciliationRequired: row.reconciliation_required,
    };
  }

  private async exception(
    client: PoolClient,
    attemptId: string,
    provider: string,
    type: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_reconciliation_exceptions(
         id, attempt_id, provider, exception_type, sanitized_details
       ) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [randomUUID(), attemptId, provider, type, JSON.stringify(details)],
    );
  }
}
