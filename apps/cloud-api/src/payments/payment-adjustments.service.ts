import { Inject, Injectable } from '@nestjs/common';
import type {
  PaymentAdjustmentView,
  PaymentFinancialHistoryView,
  RefundPaymentRequest,
  ReversePaymentRequest,
} from '@event-commerce/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type ProviderStatusResult,
} from './payment-provider';

type AdjustmentKind = 'REFUND' | 'REVERSAL';
type AdjustmentStatus = 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

interface PaymentRow extends QueryResultRow {
  amount_minor: string;
  currency: string;
}

interface RailRow extends QueryResultRow {
  provider_id: string;
  provider_reference: string;
}

interface ReservedRow extends QueryResultRow {
  amount_minor: string;
}

interface AdjustmentRow extends QueryResultRow {
  id: string;
  payment_id: string;
  provider_id: string;
  source_provider_reference: string;
  amount_minor: string;
  currency: string;
  reason: string;
  requesting_actor_id: string;
  approving_actor_id?: string | null;
  provider_reference: string | null;
  failure_code: string | null;
  idempotency_key: string;
  status: AdjustmentStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AdjustmentInput {
  id: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  requestingActorId: string;
  approvingActorId: string | null;
  idempotencyKey: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function view(kind: AdjustmentKind, row: AdjustmentRow): PaymentAdjustmentView {
  return {
    kind,
    id: row.id,
    paymentId: row.payment_id,
    providerId: row.provider_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    reason: row.reason,
    requestingActorId: row.requesting_actor_id,
    approvingActorId: row.approving_actor_id ?? null,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    providerReference: row.provider_reference,
    failureCode: row.failure_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

@Injectable()
export class PaymentAdjustmentsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: readonly PaymentProvider[],
  ) {}

  async refund(request: RefundPaymentRequest): Promise<PaymentAdjustmentView> {
    return this.requestAdjustment('REFUND', {
      id: request.refundId,
      paymentId: request.paymentId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      reason: request.reason,
      requestingActorId: request.requestingActorId,
      approvingActorId: request.approvingActorId ?? null,
      idempotencyKey: request.idempotencyKey,
    });
  }

  async reverse(request: ReversePaymentRequest): Promise<PaymentAdjustmentView> {
    return this.requestAdjustment('REVERSAL', {
      id: request.reversalId,
      paymentId: request.paymentId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      reason: request.reason,
      requestingActorId: request.requestingActorId,
      approvingActorId: null,
      idempotencyKey: request.idempotencyKey,
    });
  }

  async history(paymentId: string): Promise<PaymentFinancialHistoryView> {
    const refunds = await this.db.query<AdjustmentRow>(
      `${this.select('REFUND')} WHERE payment_id=$1 ORDER BY created_at`,
      [paymentId],
    );
    const reversals = await this.db.query<AdjustmentRow>(
      `${this.select('REVERSAL')} WHERE payment_id=$1 ORDER BY created_at`,
      [paymentId],
    );
    return {
      paymentId,
      refunds: refunds.map((row) => view('REFUND', row)),
      reversals: reversals.map((row) => view('REVERSAL', row)),
    };
  }

  private async requestAdjustment(
    kind: AdjustmentKind,
    input: AdjustmentInput,
  ): Promise<PaymentAdjustmentView> {
    const claim = await this.db.transaction(async (client) => {
      const payment = await client.query<PaymentRow>(
        `SELECT amount_minor::text,currency FROM payments WHERE id=$1 FOR UPDATE`,
        [input.paymentId],
      );
      const paymentRow = payment.rows[0];
      if (!paymentRow) throw new Error('Payment not found');

      const existing = await this.loadByIdempotency(client, kind, input.idempotencyKey, true);
      if (existing) {
        this.assertSameRequest(existing, input);
        if (
          existing.status === 'REQUESTED' &&
          Date.now() - new Date(existing.updated_at).getTime() >= 60_000
        ) {
          await client.query(
            `UPDATE ${this.table(kind)}
             SET status='UNKNOWN',failure_code='AMBIGUOUS_ADJUSTMENT_CRASH',updated_at=now()
             WHERE id=$1 AND status='REQUESTED'`,
            [existing.id],
          );
          const uncertain = await this.loadById(client, kind, existing.id, false);
          if (!uncertain) throw new Error('Payment adjustment disappeared');
          return { owner: false as const, row: uncertain };
        }
        return { owner: false as const, row: existing };
      }

      if (paymentRow.currency !== input.currency) {
        throw new Error('Adjustment currency must match the original payment');
      }
      if (input.amountMinor > Number(paymentRow.amount_minor)) {
        throw new Error('Adjustment amount cannot exceed the original payment');
      }

      const rail = await client.query<RailRow>(
        `SELECT provider_id,provider_reference
         FROM payment_attempts
         WHERE payment_id=$1 AND status='SUCCEEDED' AND provider_reference IS NOT NULL
         ORDER BY resolved_at DESC NULLS LAST,created_at DESC
         LIMIT 1`,
        [input.paymentId],
      );
      const railRow = rail.rows[0];
      if (!railRow) throw new Error('Payment has no successful provider transaction to adjust');

      const provider = this.provider(railRow.provider_id);
      const supported =
        kind === 'REFUND'
          ? provider.capabilities().refunds && typeof provider.refund === 'function'
          : provider.capabilities().reversals && typeof provider.reverse === 'function';
      if (!supported) throw new Error(`Provider ${provider.id} does not support ${kind.toLowerCase()}s`);

      const reserved = await client.query<ReservedRow>(
        `SELECT (
           COALESCE((SELECT SUM(amount_minor) FROM payment_refunds
                     WHERE payment_id=$1 AND status <> 'FAILED'),0) +
           COALESCE((SELECT SUM(amount_minor) FROM payment_reversals
                     WHERE payment_id=$1 AND status <> 'FAILED'),0)
         )::text AS amount_minor`,
        [input.paymentId],
      );
      const reservedMinor = Number(reserved.rows[0]?.amount_minor ?? '0');
      if (reservedMinor + input.amountMinor > Number(paymentRow.amount_minor)) {
        throw new Error('Adjustment would exceed the unadjusted payment balance');
      }

      const inserted = await this.insertRequested(client, kind, input, railRow);
      return { owner: true as const, row: inserted };
    });

    if (!claim.owner) return view(kind, claim.row);

    const provider = this.provider(claim.row.provider_id);
    let result: ProviderStatusResult;
    try {
      const call = kind === 'REFUND' ? provider.refund : provider.reverse;
      if (!call) throw new Error('Provider adjustment capability disappeared');
      result = await call.call(provider, {
        providerReference: claim.row.source_provider_reference,
        amountMinor: Number(claim.row.amount_minor),
        currency: claim.row.currency,
        idempotencyKey: claim.row.idempotency_key,
      });
    } catch {
      result = { status: 'UNKNOWN', failureCode: 'PROVIDER_ADJUSTMENT_ERROR' };
    }

    await this.db.query(
      `UPDATE ${this.table(kind)}
       SET status=$2,provider_reference=coalesce($3,provider_reference),failure_code=$4,updated_at=now()
       WHERE id=$1 AND status='REQUESTED'`,
      [claim.row.id, result.status, result.providerReference ?? null, result.failureCode ?? null],
    );
    const saved = await this.loadByIdDb(kind, claim.row.id);
    if (!saved) throw new Error('Payment adjustment disappeared after provider call');
    return view(kind, saved);
  }

  private async insertRequested(
    client: PoolClient,
    kind: AdjustmentKind,
    input: AdjustmentInput,
    rail: RailRow,
  ): Promise<AdjustmentRow> {
    if (kind === 'REFUND') {
      const inserted = await client.query<AdjustmentRow>(
        `INSERT INTO payment_refunds(
           id,payment_id,provider_id,source_provider_reference,amount_minor,currency,reason,
           requesting_actor_id,approving_actor_id,idempotency_key,status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUESTED')
         RETURNING id,payment_id,provider_id,source_provider_reference,amount_minor::text,currency,
                   reason,requesting_actor_id,approving_actor_id,provider_reference,failure_code,
                   idempotency_key,status,created_at,updated_at`,
        [
          input.id,
          input.paymentId,
          rail.provider_id,
          rail.provider_reference,
          input.amountMinor,
          input.currency,
          input.reason,
          input.requestingActorId,
          input.approvingActorId,
          input.idempotencyKey,
        ],
      );
      return inserted.rows[0]!;
    }

    const inserted = await client.query<AdjustmentRow>(
      `INSERT INTO payment_reversals(
         id,payment_id,provider_id,source_provider_reference,amount_minor,currency,reason,
         requesting_actor_id,idempotency_key,status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'REQUESTED')
       RETURNING id,payment_id,provider_id,source_provider_reference,amount_minor::text,currency,
                 reason,requesting_actor_id,NULL::text AS approving_actor_id,provider_reference,
                 failure_code,idempotency_key,status,created_at,updated_at`,
      [
        input.id,
        input.paymentId,
        rail.provider_id,
        rail.provider_reference,
        input.amountMinor,
        input.currency,
        input.reason,
        input.requestingActorId,
        input.idempotencyKey,
      ],
    );
    return inserted.rows[0]!;
  }

  private assertSameRequest(existing: AdjustmentRow, input: AdjustmentInput): void {
    if (
      existing.id !== input.id ||
      existing.payment_id !== input.paymentId ||
      Number(existing.amount_minor) !== input.amountMinor ||
      existing.currency !== input.currency ||
      existing.reason !== input.reason ||
      existing.requesting_actor_id !== input.requestingActorId ||
      (existing.approving_actor_id ?? null) !== input.approvingActorId
    ) {
      throw new Error('Adjustment idempotency key was reused for a different request');
    }
  }

  private provider(providerId: string): PaymentProvider {
    const normalized = providerId.trim().toLowerCase();
    const provider = this.providers.find((candidate) => candidate.id === normalized);
    if (!provider) throw new Error(`Unsupported payment provider: ${providerId}`);
    return provider;
  }

  private table(kind: AdjustmentKind): 'payment_refunds' | 'payment_reversals' {
    return kind === 'REFUND' ? 'payment_refunds' : 'payment_reversals';
  }

  private select(kind: AdjustmentKind): string {
    const approving =
      kind === 'REFUND' ? 'approving_actor_id' : 'NULL::text AS approving_actor_id';
    return `SELECT id,payment_id,provider_id,source_provider_reference,amount_minor::text,currency,
                   reason,requesting_actor_id,${approving},provider_reference,failure_code,
                   idempotency_key,status,created_at,updated_at
            FROM ${this.table(kind)}`;
  }

  private async loadByIdempotency(
    client: PoolClient,
    kind: AdjustmentKind,
    idempotencyKey: string,
    forUpdate: boolean,
  ): Promise<AdjustmentRow | undefined> {
    const result = await client.query<AdjustmentRow>(
      `${this.select(kind)} WHERE idempotency_key=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [idempotencyKey],
    );
    return result.rows[0];
  }

  private async loadById(
    client: PoolClient,
    kind: AdjustmentKind,
    id: string,
    forUpdate: boolean,
  ): Promise<AdjustmentRow | undefined> {
    const result = await client.query<AdjustmentRow>(
      `${this.select(kind)} WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0];
  }

  private async loadByIdDb(
    kind: AdjustmentKind,
    id: string,
  ): Promise<AdjustmentRow | undefined> {
    const rows = await this.db.query<AdjustmentRow>(`${this.select(kind)} WHERE id=$1`, [id]);
    return rows[0];
  }
}
