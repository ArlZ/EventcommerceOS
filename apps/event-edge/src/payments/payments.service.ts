import { Inject, Injectable } from '@nestjs/common';
import type { InitiatePaymentRequest, PaymentAttemptView } from '@event-commerce/contracts';
import { canTransitionPaymentAttempt, paymentAttemptIsTerminal } from '@event-commerce/domain';
import type { QueryResultRow } from 'pg';
import { EdgeDatabaseService } from '../database/database.service';

interface CachedAttemptRow extends QueryResultRow {
  payment_attempt_id: string;
  payment_id: string;
  event_id: string;
  order_id: string;
  provider_id: string;
  idempotency_key: string;
  amount_minor: string;
  currency: string;
  status: PaymentAttemptView['status'];
  provider_reference: string | null;
  failure_code: string | null;
  updated_at: Date | string;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payment payload must be an object');
  }
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

export function parseEdgeInitiatePayment(value: unknown): InitiatePaymentRequest {
  const record = parseObject(value);
  const amountMinor = record.amountMinor;
  if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
    throw new Error('amountMinor must be a positive safe integer');
  }
  const currency = text(record, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a three-letter code');

  const request: InitiatePaymentRequest = {
    eventId: text(record, 'eventId'),
    paymentId: text(record, 'paymentId'),
    paymentAttemptId: text(record, 'paymentAttemptId'),
    orderId: text(record, 'orderId'),
    providerId: text(record, 'providerId').toLowerCase(),
    idempotencyKey: text(record, 'idempotencyKey'),
    amountMinor: amountMinor as number,
    currency,
    accountReference: text(record, 'accountReference'),
  };
  const phone = optionalText(record, 'customerPhone');
  const description = optionalText(record, 'description');
  if (phone) request.customerPhone = phone;
  if (description) request.description = description;
  return request;
}

@Injectable()
export class EdgePaymentsService {
  constructor(@Inject(EdgeDatabaseService) private readonly db: EdgeDatabaseService) {}

  async initiate(request: InitiatePaymentRequest): Promise<PaymentAttemptView> {
    await this.cache(
      {
        eventId: request.eventId,
        paymentId: request.paymentId,
        paymentAttemptId: request.paymentAttemptId,
        orderId: request.orderId,
        providerId: request.providerId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        status: 'CREATED',
        providerReference: null,
        failureCode: null,
        reconciliationRequired: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      request.idempotencyKey,
    );

    try {
      const response = await fetch(this.cloudUrl('/payments/initiate'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
      if (!response.ok) throw new Error(`cloud payments returned HTTP ${response.status}`);
      const view = this.parsePaymentView(await response.json());
      return this.cache(view, request.idempotencyKey);
    } catch {
      const uncertain: PaymentAttemptView = {
        eventId: request.eventId,
        paymentId: request.paymentId,
        paymentAttemptId: request.paymentAttemptId,
        orderId: request.orderId,
        providerId: request.providerId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        status: 'UNKNOWN',
        providerReference: null,
        failureCode: 'EDGE_CLOUD_TRANSPORT_UNCERTAIN',
        reconciliationRequired: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return this.cache(uncertain, request.idempotencyKey);
    }
  }

  async reconcile(paymentAttemptId: string): Promise<PaymentAttemptView> {
    const current = await this.cached(paymentAttemptId);
    if (!current) throw new Error('payment attempt is not cached at Edge');
    try {
      const response = await fetch(
        this.cloudUrl(`/payments/attempts/${encodeURIComponent(paymentAttemptId)}/reconcile`),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs()),
        },
      );
      if (!response.ok) throw new Error(`cloud reconciliation returned HTTP ${response.status}`);
      const view = this.parsePaymentView(await response.json());
      return this.cache(view, current.idempotency_key);
    } catch {
      const latest = await this.cached(paymentAttemptId);
      return latest ? this.toView(latest) : this.toView(current);
    }
  }

  async byOrder(orderId: string): Promise<PaymentAttemptView[]> {
    const rows = await this.db.query<CachedAttemptRow>(
      `${this.select()} WHERE order_id=$1 ORDER BY updated_at`,
      [orderId],
    );
    return rows.map((row) => this.toView(row));
  }

  private async cached(paymentAttemptId: string): Promise<CachedAttemptRow | undefined> {
    const rows = await this.db.query<CachedAttemptRow>(
      `${this.select()} WHERE payment_attempt_id=$1`,
      [paymentAttemptId],
    );
    return rows[0];
  }

  private async cache(view: PaymentAttemptView, idempotencyKey: string): Promise<PaymentAttemptView> {
    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `edge-payment:${view.paymentAttemptId}`,
      ]);
      const existingResult = await client.query<CachedAttemptRow>(
        `${this.select()} WHERE payment_attempt_id=$1 FOR UPDATE`,
        [view.paymentAttemptId],
      );
      const existing = existingResult.rows[0];

      if (!existing) {
        await client.query(
          `INSERT INTO edge_payment_attempt_cache(
             payment_attempt_id,payment_id,event_id,order_id,provider_id,idempotency_key,
             amount_minor,currency,status,provider_reference,failure_code,updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
          [
            view.paymentAttemptId,
            view.paymentId,
            view.eventId,
            view.orderId,
            view.providerId,
            idempotencyKey,
            view.amountMinor,
            view.currency,
            view.status,
            view.providerReference,
            view.failureCode,
          ],
        );
        const inserted = await client.query<CachedAttemptRow>(
          `${this.select()} WHERE payment_attempt_id=$1`,
          [view.paymentAttemptId],
        );
        return this.toView(inserted.rows[0]!);
      }

      this.assertSameIdentity(existing, view, idempotencyKey);

      if (
        existing.provider_reference !== null &&
        view.providerReference !== null &&
        existing.provider_reference !== view.providerReference
      ) {
        if (paymentAttemptIsTerminal(existing.status)) return this.toView(existing);
        await client.query(
          `UPDATE edge_payment_attempt_cache
           SET status='UNKNOWN',failure_code='EDGE_PROVIDER_REFERENCE_CONFLICT',updated_at=now()
           WHERE payment_attempt_id=$1`,
          [view.paymentAttemptId],
        );
        const conflicted = await client.query<CachedAttemptRow>(
          `${this.select()} WHERE payment_attempt_id=$1`,
          [view.paymentAttemptId],
        );
        return this.toView(conflicted.rows[0]!);
      }

      if (!canTransitionPaymentAttempt(existing.status, view.status)) {
        return this.toView(existing);
      }

      await client.query(
        `UPDATE edge_payment_attempt_cache
         SET provider_reference=coalesce($2,provider_reference),
             status=$3,failure_code=$4,updated_at=now()
         WHERE payment_attempt_id=$1`,
        [view.paymentAttemptId, view.providerReference, view.status, view.failureCode],
      );
      const updated = await client.query<CachedAttemptRow>(
        `${this.select()} WHERE payment_attempt_id=$1`,
        [view.paymentAttemptId],
      );
      return this.toView(updated.rows[0]!);
    });
  }

  private assertSameIdentity(
    existing: CachedAttemptRow,
    view: PaymentAttemptView,
    idempotencyKey: string,
  ): void {
    if (
      existing.payment_id !== view.paymentId ||
      existing.event_id !== view.eventId ||
      existing.order_id !== view.orderId ||
      existing.provider_id !== view.providerId ||
      existing.idempotency_key !== idempotencyKey ||
      Number(existing.amount_minor) !== view.amountMinor ||
      existing.currency !== view.currency
    ) {
      throw new Error('payment attempt identity conflicts with Edge cache');
    }
  }

  private select(): string {
    return `SELECT payment_attempt_id,payment_id,event_id,order_id,provider_id,idempotency_key,
                   amount_minor::text,currency,status,provider_reference,failure_code,updated_at
            FROM edge_payment_attempt_cache`;
  }

  private toView(row: CachedAttemptRow): PaymentAttemptView {
    const updatedAt =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString();
    return {
      eventId: row.event_id,
      paymentId: row.payment_id,
      paymentAttemptId: row.payment_attempt_id,
      orderId: row.order_id,
      providerId: row.provider_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      providerReference: row.provider_reference,
      failureCode: row.failure_code,
      reconciliationRequired: row.status === 'UNKNOWN',
      createdAt: updatedAt,
      updatedAt,
    };
  }

  private parsePaymentView(value: unknown): PaymentAttemptView {
    const record = parseObject(value);
    const status = text(record, 'status');
    if (!['CREATED', 'INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(status)) {
      throw new Error('cloud returned invalid payment status');
    }
    const amountMinor = record.amountMinor;
    if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
      throw new Error('cloud returned invalid amountMinor');
    }
    const providerReference = record.providerReference;
    const failureCode = record.failureCode;
    if (providerReference !== null && typeof providerReference !== 'string') {
      throw new Error('cloud returned invalid providerReference');
    }
    if (failureCode !== null && typeof failureCode !== 'string') {
      throw new Error('cloud returned invalid failureCode');
    }
    return {
      eventId: text(record, 'eventId'),
      paymentId: text(record, 'paymentId'),
      paymentAttemptId: text(record, 'paymentAttemptId'),
      orderId: text(record, 'orderId'),
      providerId: text(record, 'providerId'),
      amountMinor: amountMinor as number,
      currency: text(record, 'currency'),
      status: status as PaymentAttemptView['status'],
      providerReference: providerReference as string | null,
      failureCode: failureCode as string | null,
      reconciliationRequired: status === 'UNKNOWN',
      createdAt: text(record, 'createdAt'),
      updatedAt: text(record, 'updatedAt'),
    };
  }

  private cloudUrl(path: string): string {
    const base = (process.env.CLOUD_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    const parsed = new URL(base);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !loopback) {
      throw new Error('Cloud API URL must use HTTPS outside loopback development');
    }
    return `${base}${path}`;
  }

  private timeoutMs(): number {
    const value = Number(process.env.CLOUD_PAYMENT_TIMEOUT_MS ?? '10000');
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error('CLOUD_PAYMENT_TIMEOUT_MS must be positive');
    return value;
  }
}
