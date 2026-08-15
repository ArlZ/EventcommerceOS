import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type {
  InitiatePaymentRequest,
  PaymentAttemptView,
  PaymentProviderHealthView,
} from '@event-commerce/contracts';
import {
  assertPaymentAttemptTransition,
  paymentAttemptIsTerminal,
  type PaymentAttemptState,
} from '@event-commerce/domain';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type ProviderInitiationResult,
  type ProviderStatusResult,
  type ProviderTruthState,
  type ProviderWebhookContext,
  type VerifiedProviderCallback,
} from './payment-provider';

interface AttemptRow extends QueryResultRow {
  id: string;
  payment_id: string;
  event_id: string;
  order_id: string;
  provider_id: string;
  idempotency_key: string;
  amount_minor: string;
  currency: string;
  status: PaymentAttemptState;
  provider_reference: string | null;
  failure_code: string | null;
  request_fingerprint: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PaymentRow extends QueryResultRow {
  id: string;
  event_id: string;
  order_id: string;
  amount_minor: string;
  currency: string;
}

interface ReconciliationJobRow extends QueryResultRow {
  payment_attempt_id: string;
  attempt_count: number;
}

interface IdRow extends QueryResultRow {
  id: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function attemptView(row: AttemptRow): PaymentAttemptView {
  return {
    eventId: row.event_id,
    paymentId: row.payment_id,
    paymentAttemptId: row.id,
    orderId: row.order_id,
    providerId: row.provider_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    providerReference: row.provider_reference,
    failureCode: row.failure_code,
    reconciliationRequired: row.status === 'UNKNOWN',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function requestFingerprint(request: InitiatePaymentRequest): string {
  const material = JSON.stringify({
    eventId: request.eventId,
    paymentId: request.paymentId,
    paymentAttemptId: request.paymentAttemptId,
    orderId: request.orderId,
    providerId: request.providerId,
    amountMinor: request.amountMinor,
    currency: request.currency,
    customerPhone: request.customerPhone ?? null,
    accountReference: request.accountReference,
  });
  return createHash('sha256').update(material).digest('hex');
}

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private reconcileTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: readonly PaymentProvider[],
  ) {}

  onModuleInit(): void {
    if (process.env.PAYMENT_RECONCILIATION_DISABLED === 'true') return;
    const intervalMs = Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS ?? '15000');
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) {
      throw new Error('PAYMENT_RECONCILIATION_INTERVAL_MS must be an integer >= 1000');
    }
    this.reconcileTimer = setInterval(() => {
      void this.reconcileDue().catch(() => undefined);
    }, intervalMs);
    this.reconcileTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  async initiate(request: InitiatePaymentRequest): Promise<PaymentAttemptView> {
    const fingerprint = requestFingerprint(request);
    const ownsInitiation = await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO payments(id,event_id,order_id,amount_minor,currency)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [
          request.paymentId,
          request.eventId,
          request.orderId,
          request.amountMinor,
          request.currency,
        ],
      );

      const payment = await client.query<PaymentRow>(
        `SELECT id,event_id,order_id,amount_minor::text,currency
         FROM payments WHERE id=$1 FOR UPDATE`,
        [request.paymentId],
      );
      const existingPayment = payment.rows[0];
      if (!existingPayment) throw new Error('Payment creation failed');
      if (
        existingPayment.event_id !== request.eventId ||
        existingPayment.order_id !== request.orderId ||
        Number(existingPayment.amount_minor) !== request.amountMinor ||
        existingPayment.currency !== request.currency
      ) {
        throw new Error('Payment identity conflicts with existing financial record');
      }

      const inserted = await client.query<IdRow>(
        `INSERT INTO payment_attempts(
           id,payment_id,provider_id,idempotency_key,status,request_fingerprint
         ) VALUES ($1,$2,$3,$4,'CREATED',$5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          request.paymentAttemptId,
          request.paymentId,
          request.providerId,
          request.idempotencyKey,
          fingerprint,
        ],
      );
      if (inserted.rows.length === 1) return true;

      const existing = await this.loadAttemptByIdempotencyClient(
        client,
        request.idempotencyKey,
        true,
      );
      if (!existing) throw new Error('Idempotency conflict without existing payment attempt');
      if (existing.request_fingerprint !== fingerprint) {
        throw new Error('Idempotency key was reused for a different payment request');
      }

      // A duplicate request must never steal an in-flight provider initiation from the
      // original owner. If the owner actually crashed, the stale-CREATED watchdog below
      // moves the attempt to UNKNOWN/manual review after the provider timeout window.
      return false;
    });

    if (!ownsInitiation) {
      const replay = await this.loadAttemptByIdempotency(request.idempotencyKey);
      if (!replay) throw new Error('Payment attempt disappeared after idempotent replay');
      return attemptView(replay);
    }

    let result: ProviderInitiationResult;
    try {
      result = await this.provider(request.providerId).initiate({
        paymentAttemptId: request.paymentAttemptId,
        idempotencyKey: request.idempotencyKey,
        amountMinor: request.amountMinor,
        currency: request.currency,
        ...(request.customerPhone ? { customerPhone: request.customerPhone } : {}),
        accountReference: request.accountReference,
        ...(request.description ? { description: request.description } : {}),
      });
    } catch {
      result = { status: 'UNKNOWN', failureCode: 'PROVIDER_ADAPTER_ERROR' };
    }

    await this.applyInitiationResult(request.paymentAttemptId, result);
    const saved = await this.loadAttemptById(request.paymentAttemptId);
    if (!saved) throw new Error('Payment attempt disappeared after provider initiation');
    return attemptView(saved);
  }

  async ingestProviderCallback(
    providerId: string,
    payload: unknown,
    context?: ProviderWebhookContext,
  ): Promise<{ status: 'APPLIED' | 'DUPLICATE' | 'UNMATCHED' | 'CONFLICT' }> {
    const provider = this.provider(providerId);
    if (!provider.capabilities().asynchronousCallbacks) {
      throw new Error(`Provider ${provider.id} does not accept asynchronous callbacks`);
    }
    const callback = await provider.parseAndVerifyWebhook(payload, context);

    return this.db.transaction(async (client) => {
      const inserted = await client.query<IdRow>(
        `INSERT INTO payment_provider_events(provider_id,provider_event_key,event_kind,payload)
         VALUES ($1,$2,'CALLBACK',$3::jsonb)
         ON CONFLICT (provider_id,provider_event_key) DO NOTHING
         RETURNING id::text`,
        [
          provider.id,
          callback.providerEventKey,
          JSON.stringify({
            paymentAttemptId: callback.paymentAttemptId ?? null,
            providerReference: callback.providerReference ?? null,
            status: callback.status,
            amountMinor: callback.amountMinor ?? null,
            currency: callback.currency ?? null,
            failureCode: callback.failureCode ?? null,
          }),
        ],
      );
      if (inserted.rows.length === 0) return { status: 'DUPLICATE' as const };
      if (!callback.paymentAttemptId && !callback.providerReference) {
        return { status: 'UNMATCHED' as const };
      }

      const attempt = callback.paymentAttemptId
        ? await this.loadAttemptByIdClient(client, callback.paymentAttemptId, true)
        : await this.loadAttemptByProviderReferenceClient(
            client,
            provider.id,
            callback.providerReference!,
            true,
          );
      if (!attempt) return { status: 'UNMATCHED' as const };
      if (attempt.provider_id !== provider.id) return { status: 'CONFLICT' as const };

      await client.query(
        `UPDATE payment_provider_events SET payment_attempt_id=$1 WHERE id=$2::bigint`,
        [attempt.id, inserted.rows[0]!.id],
      );
      const applied = await this.applyProviderTruth(client, attempt, callback);
      return { status: applied ? ('APPLIED' as const) : ('CONFLICT' as const) };
    });
  }

  async reconcileAttempt(paymentAttemptId: string): Promise<PaymentAttemptView> {
    const current = await this.loadAttemptById(paymentAttemptId);
    if (!current) throw new Error('Payment attempt not found');
    if (!['INITIATED', 'PENDING', 'UNKNOWN'].includes(current.status)) return attemptView(current);

    const provider = this.provider(current.provider_id);
    if (!current.provider_reference) {
      await this.db.transaction(async (client) => {
        await this.upsertReconciliationJob(
          client,
          current.id,
          'MANUAL_REVIEW',
          'MISSING_PROVIDER_REFERENCE',
        );
      });
      return attemptView(current);
    }
    if (!provider.capabilities().queryStatus) {
      await this.db.transaction(async (client) => {
        await this.upsertReconciliationJob(
          client,
          current.id,
          'MANUAL_REVIEW',
          'PROVIDER_STATUS_QUERY_UNSUPPORTED',
        );
      });
      return attemptView(current);
    }

    let result: ProviderStatusResult;
    try {
      result = await provider.queryStatus(current.provider_reference);
    } catch {
      result = {
        status: 'UNKNOWN',
        providerReference: current.provider_reference,
        failureCode: 'PROVIDER_ADAPTER_ERROR',
      };
    }

    await this.db.transaction(async (client) => {
      const locked = await this.loadAttemptByIdClient(client, paymentAttemptId, true);
      if (!locked || !['INITIATED', 'PENDING', 'UNKNOWN'].includes(locked.status)) return;
      const applied = await this.applyProviderTruth(client, locked, {
        paymentAttemptId: result.paymentAttemptId,
        providerReference: result.providerReference ?? current.provider_reference,
        status: result.status,
        amountMinor: result.amountMinor,
        currency: result.currency,
        failureCode: result.failureCode,
      });
      if (applied && (result.status === 'PENDING' || result.status === 'UNKNOWN')) {
        await this.scheduleRetry(client, paymentAttemptId, result.failureCode);
      }
    });

    const updated = await this.loadAttemptById(paymentAttemptId);
    if (!updated) throw new Error('Payment attempt disappeared during reconciliation');
    return attemptView(updated);
  }

  async byOrder(orderId: string): Promise<PaymentAttemptView[]> {
    const rows = await this.db.query<AttemptRow>(
      `${this.attemptSelect()} WHERE p.order_id=$1 ORDER BY pa.created_at ASC`,
      [orderId],
    );
    return rows.map(attemptView);
  }

  async health(eventId: string): Promise<PaymentProviderHealthView[]> {
    const rows = await this.db.query<{
      provider_id: string;
      pending_count: string;
      unknown_count: string;
      unknown_value_minor: string;
      oldest_unknown_at: Date | string | null;
    }>(
      `SELECT pa.provider_id,
              count(*) FILTER (WHERE pa.status='PENDING')::text AS pending_count,
              count(*) FILTER (WHERE pa.status='UNKNOWN')::text AS unknown_count,
              coalesce(sum(p.amount_minor) FILTER (WHERE pa.status='UNKNOWN'),0)::text AS unknown_value_minor,
              min(pa.updated_at) FILTER (WHERE pa.status='UNKNOWN') AS oldest_unknown_at
       FROM payment_attempts pa
       JOIN payments p ON p.id=pa.payment_id
       WHERE p.event_id=$1
       GROUP BY pa.provider_id
       ORDER BY pa.provider_id`,
      [eventId],
    );
    return rows.map((row) => ({
      providerId: row.provider_id,
      pendingCount: Number(row.pending_count),
      unknownCount: Number(row.unknown_count),
      unknownValueMinor: Number(row.unknown_value_minor),
      oldestUnknownAt: row.oldest_unknown_at ? iso(row.oldest_unknown_at) : null,
    }));
  }

  private async reconcileDue(): Promise<void> {
    await this.promoteStaleCreatedAttempts();

    const due = await this.db.query<ReconciliationJobRow>(
      `SELECT payment_attempt_id,attempt_count
       FROM payment_reconciliation_jobs
       WHERE status='PENDING' AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       LIMIT 20`,
    );
    for (const job of due) {
      try {
        await this.reconcileAttempt(job.payment_attempt_id);
      } catch {
        await this.db.transaction(async (client) => {
          await this.scheduleRetry(client, job.payment_attempt_id, 'RECONCILIATION_ERROR');
        });
      }
    }
  }

  private async promoteStaleCreatedAttempts(): Promise<void> {
    await this.db.transaction(async (client) => {
      const stale = await client.query<IdRow>(
        `SELECT id
         FROM payment_attempts
         WHERE status='CREATED'
           AND updated_at <= now() - interval '60 seconds'
         ORDER BY updated_at
         FOR UPDATE SKIP LOCKED
         LIMIT 20`,
      );

      for (const row of stale.rows) {
        await client.query(
          `UPDATE payment_attempts
           SET status='UNKNOWN',failure_code='AMBIGUOUS_INITIATION_CRASH',updated_at=now()
           WHERE id=$1 AND status='CREATED'`,
          [row.id],
        );
        await this.upsertReconciliationJob(
          client,
          row.id,
          'MANUAL_REVIEW',
          'AMBIGUOUS_INITIATION_CRASH',
        );
      }
    });
  }

  private async applyInitiationResult(
    paymentAttemptId: string,
    result: ProviderInitiationResult,
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      const current = await this.loadAttemptByIdClient(client, paymentAttemptId, true);
      if (!current) throw new Error('Payment attempt not found');
      if (current.status !== 'CREATED') return;
      assertPaymentAttemptTransition(current.status, result.status);
      await client.query(
        `UPDATE payment_attempts
         SET status=$2,
             provider_reference=coalesce($3,provider_reference),
             failure_code=$4,
             initiated_at=coalesce(initiated_at,now()),
             resolved_at=CASE WHEN $2 IN ('SUCCEEDED','FAILED') THEN now() ELSE resolved_at END,
             updated_at=now()
         WHERE id=$1`,
        [
          paymentAttemptId,
          result.status,
          result.providerReference ?? null,
          result.failureCode ?? null,
        ],
      );

      if (['INITIATED', 'PENDING', 'UNKNOWN'].includes(result.status)) {
        await this.upsertReconciliationJob(
          client,
          paymentAttemptId,
          result.providerReference ? 'PENDING' : 'MANUAL_REVIEW',
          result.providerReference ? result.failureCode : 'MISSING_PROVIDER_REFERENCE',
        );
      } else if (result.status === 'FAILED') {
        await this.upsertReconciliationJob(client, paymentAttemptId, 'RESOLVED');
      }
    });

    const attempt = await this.loadAttemptById(paymentAttemptId);
    if (attempt) await this.applyUnmatchedCallbacks(attempt);
  }

  private async applyUnmatchedCallbacks(attempt: AttemptRow): Promise<void> {
    const events = await this.db.query<{
      id: string;
      payload: {
        paymentAttemptId?: string | null;
        status: ProviderTruthState;
        providerReference?: string | null;
        amountMinor?: number | null;
        currency?: string | null;
        failureCode?: string | null;
      };
    }>(
      `SELECT id::text,payload
       FROM payment_provider_events
       WHERE provider_id=$1 AND payment_attempt_id IS NULL
         AND (
           payload->>'paymentAttemptId'=$2
           OR ($3::text IS NOT NULL AND payload->>'providerReference'=$3)
         )
       ORDER BY received_at`,
      [attempt.provider_id, attempt.id, attempt.provider_reference],
    );

    for (const event of events) {
      await this.db.transaction(async (client) => {
        const locked = await this.loadAttemptByIdClient(client, attempt.id, true);
        if (!locked) return;
        const payload = event.payload;
        const callback: VerifiedProviderCallback = {
          providerEventKey: `stored:${event.id}`,
          ...(typeof payload.paymentAttemptId === 'string'
            ? { paymentAttemptId: payload.paymentAttemptId }
            : {}),
          ...(typeof payload.providerReference === 'string'
            ? { providerReference: payload.providerReference }
            : {}),
          status: payload.status,
          ...(typeof payload.amountMinor === 'number' ? { amountMinor: payload.amountMinor } : {}),
          ...(typeof payload.currency === 'string' ? { currency: payload.currency } : {}),
          ...(typeof payload.failureCode === 'string' ? { failureCode: payload.failureCode } : {}),
        };
        await client.query(
          `UPDATE payment_provider_events SET payment_attempt_id=$1 WHERE id=$2::bigint`,
          [locked.id, event.id],
        );
        await this.applyProviderTruth(client, locked, callback);
      });
    }
  }

  private async applyProviderTruth(
    client: PoolClient,
    current: AttemptRow,
    truth: Pick<
      VerifiedProviderCallback,
      | 'paymentAttemptId'
      | 'status'
      | 'providerReference'
      | 'amountMinor'
      | 'currency'
      | 'failureCode'
    >,
  ): Promise<boolean> {
    if (truth.paymentAttemptId !== undefined && truth.paymentAttemptId !== current.id) {
      await this.upsertReconciliationJob(
        client,
        current.id,
        'MANUAL_REVIEW',
        'PROVIDER_MERCHANT_REFERENCE_MISMATCH',
      );
      if (!paymentAttemptIsTerminal(current.status)) {
        await client.query(
          `UPDATE payment_attempts
           SET status='UNKNOWN',failure_code='PROVIDER_MERCHANT_REFERENCE_MISMATCH',updated_at=now()
           WHERE id=$1`,
          [current.id],
        );
      }
      return false;
    }

    if (
      current.provider_reference !== null &&
      truth.providerReference !== undefined &&
      truth.providerReference !== null &&
      current.provider_reference !== truth.providerReference
    ) {
      await this.upsertReconciliationJob(
        client,
        current.id,
        'MANUAL_REVIEW',
        'PROVIDER_REFERENCE_MISMATCH',
      );
      if (!paymentAttemptIsTerminal(current.status)) {
        await client.query(
          `UPDATE payment_attempts
           SET status='UNKNOWN',failure_code='PROVIDER_REFERENCE_MISMATCH',updated_at=now()
           WHERE id=$1`,
          [current.id],
        );
      }
      return false;
    }

    if (
      (truth.amountMinor !== undefined && truth.amountMinor !== Number(current.amount_minor)) ||
      (truth.currency !== undefined && truth.currency !== current.currency)
    ) {
      await this.upsertReconciliationJob(
        client,
        current.id,
        'MANUAL_REVIEW',
        'PROVIDER_AMOUNT_MISMATCH',
      );
      if (!paymentAttemptIsTerminal(current.status)) {
        await client.query(
          `UPDATE payment_attempts
           SET status='UNKNOWN',failure_code='PROVIDER_AMOUNT_MISMATCH',updated_at=now()
           WHERE id=$1`,
          [current.id],
        );
      }
      return false;
    }

    if (paymentAttemptIsTerminal(current.status) && current.status !== truth.status) {
      await this.upsertReconciliationJob(
        client,
        current.id,
        'MANUAL_REVIEW',
        'CONFLICTING_PROVIDER_TRUTH',
      );
      return false;
    }

    try {
      assertPaymentAttemptTransition(current.status, truth.status);
    } catch {
      await this.upsertReconciliationJob(
        client,
        current.id,
        'MANUAL_REVIEW',
        'INVALID_PROVIDER_TRANSITION',
      );
      return false;
    }

    await client.query(
      `UPDATE payment_attempts
       SET status=$2,
           provider_reference=coalesce($3,provider_reference),
           failure_code=$4,
           resolved_at=CASE WHEN $2 IN ('SUCCEEDED','FAILED') THEN now() ELSE resolved_at END,
           updated_at=now()
       WHERE id=$1`,
      [current.id, truth.status, truth.providerReference ?? null, truth.failureCode ?? null],
    );

    if (truth.status === 'UNKNOWN' || truth.status === 'PENDING') {
      await this.upsertReconciliationJob(client, current.id, 'PENDING', truth.failureCode);
    } else if (truth.status === 'SUCCEEDED' || truth.status === 'FAILED') {
      await this.upsertReconciliationJob(client, current.id, 'RESOLVED');
    }
    return true;
  }

  private async scheduleRetry(
    client: PoolClient,
    paymentAttemptId: string,
    errorCode?: string,
  ): Promise<void> {
    const existing = await client.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM payment_reconciliation_jobs
       WHERE payment_attempt_id=$1 FOR UPDATE`,
      [paymentAttemptId],
    );
    const nextAttempt = (existing.rows[0]?.attempt_count ?? 0) + 1;
    if (nextAttempt >= 6) {
      await this.upsertReconciliationJob(client, paymentAttemptId, 'MANUAL_REVIEW', errorCode);
      return;
    }
    const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, nextAttempt - 1));
    await client.query(
      `INSERT INTO payment_reconciliation_jobs(
         payment_attempt_id,status,attempt_count,next_attempt_at,last_error_code
       ) VALUES ($1,'PENDING',$2,now()+($3 || ' seconds')::interval,$4)
       ON CONFLICT (payment_attempt_id) DO UPDATE
       SET status='PENDING',attempt_count=$2,
           next_attempt_at=now()+($3 || ' seconds')::interval,
           last_error_code=$4,updated_at=now()`,
      [paymentAttemptId, nextAttempt, String(delaySeconds), errorCode ?? null],
    );
  }

  private async upsertReconciliationJob(
    client: PoolClient,
    paymentAttemptId: string,
    status: 'PENDING' | 'RUNNING' | 'RESOLVED' | 'MANUAL_REVIEW',
    errorCode?: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_reconciliation_jobs(payment_attempt_id,status,last_error_code)
       VALUES ($1,$2,$3)
       ON CONFLICT (payment_attempt_id) DO UPDATE
       SET status=$2,last_error_code=$3,updated_at=now()`,
      [paymentAttemptId, status, errorCode ?? null],
    );
  }

  private provider(providerId: string): PaymentProvider {
    const normalized = providerId.trim().toLowerCase();
    const provider = this.providers.find((candidate) => candidate.id === normalized);
    if (!provider) throw new Error(`Unsupported payment provider: ${providerId}`);
    return provider;
  }

  private attemptSelect(): string {
    return `SELECT pa.id,pa.payment_id,p.event_id,p.order_id,pa.provider_id,pa.idempotency_key,
                   p.amount_minor::text,p.currency,pa.status,pa.provider_reference,pa.failure_code,
                   pa.request_fingerprint,pa.created_at,pa.updated_at
            FROM payment_attempts pa JOIN payments p ON p.id=pa.payment_id`;
  }

  private async loadAttemptById(id: string): Promise<AttemptRow | undefined> {
    const rows = await this.db.query<AttemptRow>(`${this.attemptSelect()} WHERE pa.id=$1`, [id]);
    return rows[0];
  }

  private async loadAttemptByIdempotency(key: string): Promise<AttemptRow | undefined> {
    const rows = await this.db.query<AttemptRow>(
      `${this.attemptSelect()} WHERE pa.idempotency_key=$1`,
      [key],
    );
    return rows[0];
  }

  private async loadAttemptByIdClient(
    client: PoolClient,
    id: string,
    forUpdate: boolean,
  ): Promise<AttemptRow | undefined> {
    const result = await client.query<AttemptRow>(
      `${this.attemptSelect()} WHERE pa.id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0];
  }

  private async loadAttemptByIdempotencyClient(
    client: PoolClient,
    key: string,
    forUpdate: boolean,
  ): Promise<AttemptRow | undefined> {
    const result = await client.query<AttemptRow>(
      `${this.attemptSelect()} WHERE pa.idempotency_key=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [key],
    );
    return result.rows[0];
  }

  private async loadAttemptByProviderReferenceClient(
    client: PoolClient,
    providerId: string,
    providerReference: string,
    forUpdate: boolean,
  ): Promise<AttemptRow | undefined> {
    const result = await client.query<AttemptRow>(
      `${this.attemptSelect()} WHERE pa.provider_id=$1 AND pa.provider_reference=$2${
        forUpdate ? ' FOR UPDATE' : ''
      }`,
      [providerId, providerReference],
    );
    return result.rows[0];
  }
}
