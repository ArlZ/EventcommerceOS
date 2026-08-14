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
      await this.recordAttemptException(created.attempt.id, 'UNKNOWN_WITHOUT_PROVIDER_REQUEST_ID', {
        phase: 'provider-initiation-transport',
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
    if (!this.provider.capabilities().queryStatus) return;
    const claimId = randomUUID();
    const current = await this.claimReconciliation(attemptId, claimId);
    if (!current || !current.provider_request_id) return;

    try {
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
      if (result.outcome === 'UNKNOWN' || result.outcome === 'ACCEPTED_FOR_PROCESSING') {
        await this.scheduleQueryFailure(
          attemptId,
          result.reasonCode ??
            (result.outcome === 'UNKNOWN' ? 'PROVIDER_QUERY_UNKNOWN' : 'PROVIDER_STILL_PENDING'),
        );
      }
    } finally {
      await this.releaseReconciliationClaim(attemptId, claimId);
    }
  }

  async dueAttemptIds(limit = 25): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = await this.database.query<{ attempt_id: string }>(
      `SELECT s.attempt_id
       FROM payment_attempt_state s
       JOIN payment_attempts a ON a.id = s.attempt_id
       WHERE s.reconciliation_required = true
         AND a.provider_request_id IS NOT NULL
         AND s.next_query_at IS NOT NULL
         AND s.next_query_at <= clock_timestamp()
         AND (s.reconciliation_claimed_until IS NULL OR s.reconciliation_claimed_until < clock_timestamp())
       ORDER BY s.next_query_at, s.updated_at
       LIMIT $1`,
      [boundedLimit],
    );
    return rows.map((row) => row.attempt_id);
  }

  async failStaleUndispatchedAttempts(staleAfterSeconds = 30, limit = 50): Promise<number> {
    const boundedSeconds = Math.max(5, Math.min(staleAfterSeconds, 300));
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = await this.database.query<{ id: string }>(
      `SELECT a.id
       FROM payment_attempts a
       JOIN payment_attempt_state s ON s.attempt_id = a.id
       WHERE s.state = 'INITIATED'
         AND a.dispatch_started_at IS NULL
         AND a.created_at <= clock_timestamp() - make_interval(secs => $1::double precision)
       ORDER BY a.created_at
       LIMIT $2`,
      [boundedSeconds, boundedLimit],
    );
    let changed = 0;
    for (const row of rows) {
      if (await this.failUndispatchedAttempt(row.id)) changed += 1;
    }
    return changed;
  }

  private async createOrFindAttempt(input: InitiatePaymentRequest): Promise<CreateAttemptResult> {
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `payment-initiation:${input.idempotencyKey}`,
      ]);

      const existing = await this.attemptByIdempotency(client, input.idempotencyKey);
      if (existing) {
        this.assertIdempotentReplay(existing, input);
        return { attempt: existing, idempotentReplay: true };
      }

      const attemptIdentity = await client.query<{ id: string }>(
        'SELECT id FROM payment_attempts WHERE id = $1',
        [input.attemptId],
      );
      if (attemptIdentity.rowCount !== 0) {
        throw new ConflictException(
          'payment attempt ID was reused under a different idempotency key',
        );
      }

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

      const attemptId = input.attemptId;
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

  private assertIdempotentReplay(existing: AttemptRow, input: InitiatePaymentRequest): void {
    if (
      existing.id !== input.attemptId ||
      existing.payment_id !== input.paymentId ||
      existing.client_attempt_id !== input.clientAttemptId ||
      existing.provider !== input.provider ||
      existing.amount_minor !== input.amountMinor.toString() ||
      existing.currency !== input.currency ||
      existing.event_id !== input.eventId ||
      existing.order_id !== input.orderId
    ) {
      throw new ConflictException('idempotency key was reused with different payment content');
    }
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
      const row = await this.attemptWithClient(client, attemptId, true);
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
    if (result.outcome === 'ACCEPTED_FOR_PROCESSING' && !result.providerRequestId) {
      await this.applyTransition(attemptId, {
        target: 'UNKNOWN',
        source: 'PROVIDER_INITIATION',
        sourceId: `missing-request-id:${attemptId}`,
        reasonCode: 'PROVIDER_REQUEST_ID_MISSING',
        providerRequestId: null,
        providerReceiptReference: null,
      });
      await this.recordAttemptException(attemptId, 'UNKNOWN_WITHOUT_PROVIDER_REQUEST_ID', {
        phase: 'provider-initiation-response',
      });
      return;
    }
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
      const attempt = await this.attemptWithClient(client, attemptId, true);
      const duplicate = await client.query(
        `SELECT 1 FROM payment_attempt_transitions
         WHERE attempt_id = $1 AND source = $2 AND source_id = $3`,
        [attemptId, input.source, input.sourceId],
      );
      if (duplicate.rowCount === 1) return;

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
          await this.quarantineProviderConflict(
            client,
            attempt,
            'PROVIDER_REQUEST_ID_CONFLICT',
            {
              currentRequestId: attempt.provider_request_id,
              observedRequestId: input.providerRequestId,
            },
            `request-id-conflict:${input.source}:${input.sourceId}`,
          );
          return;
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `payment-provider-request:${attempt.provider}:${input.providerRequestId}`,
        ]);
        const owner = await client.query<{ id: string }>(
          `SELECT id FROM payment_attempts
           WHERE provider = $1 AND provider_request_id = $2 AND id <> $3`,
          [attempt.provider, input.providerRequestId, attemptId],
        );
        if (owner.rowCount !== 0) {
          await this.quarantineProviderConflict(
            client,
            attempt,
            'PROVIDER_REQUEST_ID_REUSED',
            {
              providerRequestId: input.providerRequestId,
              existingAttemptId: owner.rows[0]!.id,
            },
            `request-id-reused:${input.source}:${input.sourceId}`,
          );
          return;
        }
        await client.query(`UPDATE payment_attempts SET provider_request_id = $2 WHERE id = $1`, [
          attemptId,
          input.providerRequestId,
        ]);
      }

      if (input.providerReceiptReference) {
        if (
          attempt.provider_receipt_reference !== null &&
          attempt.provider_receipt_reference !== input.providerReceiptReference
        ) {
          await this.quarantineProviderConflict(
            client,
            attempt,
            'PROVIDER_RECEIPT_CONFLICT',
            {
              currentReceiptReference: attempt.provider_receipt_reference,
              observedReceiptReference: input.providerReceiptReference,
            },
            `receipt-conflict:${input.source}:${input.sourceId}`,
          );
          return;
        }
        if (attempt.provider_receipt_reference === null) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `payment-provider-receipt:${attempt.provider}:${input.providerReceiptReference}`,
          ]);
          const owner = await client.query<{ id: string }>(
            `SELECT id FROM payment_attempts
             WHERE provider = $1 AND provider_receipt_reference = $2 AND id <> $3`,
            [attempt.provider, input.providerReceiptReference, attemptId],
          );
          if (owner.rowCount !== 0) {
            await this.quarantineProviderConflict(
              client,
              attempt,
              'PROVIDER_RECEIPT_REUSED',
              {
                providerReceiptReference: input.providerReceiptReference,
                existingAttemptId: owner.rows[0]!.id,
              },
              `receipt-reused:${input.source}:${input.sourceId}`,
            );
            return;
          }
          await client.query(
            `UPDATE payment_attempts SET provider_receipt_reference = $2 WHERE id = $1`,
            [attemptId, input.providerReceiptReference],
          );
        }
      }

      const reconciliationRequired = requiresPaymentReconciliation(input.target);
      const hasProviderRequest = Boolean(input.providerRequestId ?? attempt.provider_request_id);
      await client.query(
        `UPDATE payment_attempt_state SET
           state = $2,
           reconciliation_required = $3,
           next_query_at = CASE
             WHEN $3 AND $4 THEN clock_timestamp() + interval '5 seconds'
             ELSE NULL
           END,
           last_provider_error_code = $5,
           terminal_at = CASE WHEN $3 THEN NULL ELSE COALESCE(terminal_at, clock_timestamp()) END,
           updated_at = clock_timestamp()
         WHERE attempt_id = $1`,
        [attemptId, input.target, reconciliationRequired, hasProviderRequest, input.reasonCode],
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

  private async claimReconciliation(
    attemptId: string,
    claimId: string,
  ): Promise<AttemptRow | null> {
    const claimed = await this.database.transaction(async (client) => {
      const result = await client.query<{ attempt_id: string }>(
        `UPDATE payment_attempt_state s SET
           reconciliation_claimed_until = clock_timestamp() + interval '30 seconds',
           reconciliation_claimed_by = $2,
           updated_at = clock_timestamp()
         FROM payment_attempts a
         WHERE s.attempt_id = $1
           AND a.id = s.attempt_id
           AND s.reconciliation_required = true
           AND a.provider_request_id IS NOT NULL
           AND (s.reconciliation_claimed_until IS NULL OR s.reconciliation_claimed_until < clock_timestamp())
         RETURNING s.attempt_id`,
        [attemptId, claimId],
      );
      if (result.rowCount !== 1) return null;
      return this.attemptWithClient(client, attemptId);
    });
    return claimed;
  }

  private async releaseReconciliationClaim(attemptId: string, claimId: string): Promise<void> {
    await this.database.query(
      `UPDATE payment_attempt_state SET
         reconciliation_claimed_until = NULL,
         reconciliation_claimed_by = NULL,
         updated_at = clock_timestamp()
       WHERE attempt_id = $1 AND reconciliation_claimed_by = $2`,
      [attemptId, claimId],
    );
  }

  private async quarantineProviderConflict(
    client: PoolClient,
    attempt: AttemptRow,
    exceptionType: string,
    details: Record<string, unknown>,
    sourceId: string,
  ): Promise<void> {
    await this.exception(client, attempt.id, attempt.provider, exceptionType, details);
    if (!['INITIATED', 'PENDING', 'UNKNOWN'].includes(attempt.state)) return;

    await client.query(
      `UPDATE payment_attempt_state SET
         state = 'UNKNOWN',
         reconciliation_required = true,
         next_query_at = NULL,
         last_provider_error_code = $2,
         updated_at = clock_timestamp()
       WHERE attempt_id = $1`,
      [attempt.id, exceptionType],
    );
    if (attempt.state !== 'UNKNOWN') {
      await client.query(
        `INSERT INTO payment_attempt_transitions(
           id, attempt_id, from_state, to_state, source, source_id, reason_code, occurred_at
         ) VALUES ($1,$2,$3,'UNKNOWN','SYSTEM',$4,$5,clock_timestamp())
         ON CONFLICT (attempt_id, source, source_id) DO NOTHING`,
        [randomUUID(), attempt.id, attempt.state, sourceId, exceptionType],
      );
    }
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

  private async failUndispatchedAttempt(attemptId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const attempt = await this.attemptWithClient(client, attemptId, true);
      if (attempt.state !== 'INITIATED' || attempt.dispatch_started_at !== null) return false;
      await client.query(
        `UPDATE payment_attempt_state SET
           state = 'FAILED', reconciliation_required = false, next_query_at = NULL,
           reconciliation_claimed_until = NULL, reconciliation_claimed_by = NULL,
           last_provider_error_code = 'LOCAL_DISPATCH_NEVER_STARTED',
           terminal_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE attempt_id = $1`,
        [attemptId],
      );
      await client.query(
        `INSERT INTO payment_attempt_transitions(
           id, attempt_id, from_state, to_state, source, source_id, reason_code, occurred_at
         ) VALUES ($1,$2,'INITIATED','FAILED','SYSTEM',$3,'LOCAL_DISPATCH_NEVER_STARTED',clock_timestamp())
         ON CONFLICT (attempt_id, source, source_id) DO NOTHING`,
        [randomUUID(), attemptId, `undispatched-timeout:${attemptId}`],
      );
      return true;
    });
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
      this.attemptSql(false).replace('WHERE a.id = $1', 'WHERE a.initiation_idempotency_key = $1'),
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

  private async recordAttemptException(
    attemptId: string,
    type: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const attempt = await this.attempt(attemptId);
    await this.database.transaction((client) =>
      this.exception(client, attemptId, attempt.provider, type, details),
    );
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
