import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  PaymentAttemptSnapshot,
  PaymentAttemptState,
} from '@event-commerce/contracts';
import {
  paymentRetryDisposition,
  requirePaymentAttemptTransition,
} from '@event-commerce/domain';
import { EdgeDatabaseService } from '../database/database.service';
import { PaymentCloudTransport } from './payment-cloud.transport';
import { maskEdgeMsisdn } from './payment.validation';

interface EdgeAttemptRow extends QueryResultRow {
  attempt_id: string;
  payment_id: string;
  event_id: string;
  order_id: string;
  client_attempt_id: string;
  initiation_idempotency_key: string;
  provider: string;
  amount_minor: string;
  currency: string;
  masked_payer_reference: string | null;
  state: PaymentAttemptState;
  provider_request_id: string | null;
  provider_receipt_reference: string | null;
  reconciliation_required: boolean;
  cloud_seen: boolean;
  relay_status: 'PENDING' | 'ACKNOWLEDGED' | 'UNAVAILABLE';
  last_relay_error: string | null;
  next_refresh_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface LocalAttemptResult {
  row: EdgeAttemptRow;
  replay: boolean;
}

@Injectable()
export class PaymentRelayService {
  constructor(
    @Inject(EdgeDatabaseService) private readonly database: EdgeDatabaseService,
    @Inject(PaymentCloudTransport) private readonly cloud: PaymentCloudTransport,
  ) {}

  async initiate(input: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const local = await this.createOrFind(input);
    if (this.isFinal(local.row.state) && local.row.cloud_seen) {
      return { attempt: this.snapshot(local.row), idempotentReplay: true };
    }

    try {
      const cloud = await this.cloud.initiate(input);
      this.assertCloudSnapshotMatches(local.row, cloud.attempt);
      await this.applyCloudSnapshot(cloud.attempt);
      return {
        attempt: await this.getLocalAttempt(input.attemptId),
        idempotentReplay: local.replay || cloud.idempotentReplay,
      };
    } catch {
      await this.markCloudUnavailable(input.attemptId);
      return {
        attempt: await this.getLocalAttempt(input.attemptId),
        idempotentReplay: local.replay,
      };
    }
  }

  async getAttempt(attemptId: string, refresh = true): Promise<PaymentAttemptSnapshot> {
    const local = await this.row(attemptId);
    if (refresh && (!this.isFinal(local.state) || !local.cloud_seen)) {
      await this.refreshAttempt(attemptId);
    }
    return this.getLocalAttempt(attemptId);
  }

  async refreshAttempt(attemptId: string): Promise<void> {
    const local = await this.row(attemptId);
    try {
      const cloud = await this.cloud.getAttempt(attemptId);
      if (!cloud) {
        await this.markCloudUnavailable(attemptId, 'CLOUD_ATTEMPT_NOT_FOUND');
        return;
      }
      this.assertCloudSnapshotMatches(local, cloud);
      await this.applyCloudSnapshot(cloud);
    } catch {
      await this.markCloudUnavailable(attemptId);
    }
  }

  async dueAttemptIds(limit = 25): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = await this.database.query<{ attempt_id: string }>(
      `SELECT attempt_id
       FROM edge_payment_attempts
       WHERE (reconciliation_required = true OR cloud_seen = false)
         AND (next_refresh_at IS NULL OR next_refresh_at <= clock_timestamp())
       ORDER BY COALESCE(next_refresh_at, updated_at), updated_at
       LIMIT $1`,
      [boundedLimit],
    );
    return rows.map((row) => row.attempt_id);
  }

  private async createOrFind(input: InitiatePaymentRequest): Promise<LocalAttemptResult> {
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `edge-payment-initiation:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<EdgeAttemptRow>(
        `SELECT * FROM edge_payment_attempts WHERE initiation_idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        this.assertReplayMatches(row, input);
        return { row, replay: true };
      }

      const attemptIdentity = await client.query<{ attempt_id: string }>(
        `SELECT attempt_id FROM edge_payment_attempts WHERE attempt_id = $1`,
        [input.attemptId],
      );
      if (attemptIdentity.rowCount !== 0) {
        throw new ConflictException('payment attempt ID was reused under another idempotency key');
      }

      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `edge-payment-order:${input.eventId}:${input.orderId}`,
      ]);
      const prior = await client.query<{ payment_id: string; state: PaymentAttemptState }>(
        `SELECT payment_id, state FROM edge_payment_attempts
         WHERE event_id = $1 AND order_id = $2`,
        [input.eventId, input.orderId],
      );
      if (prior.rows.some((row) => row.payment_id !== input.paymentId)) {
        throw new ConflictException('order already has a different logical payment ID');
      }
      const disposition = paymentRetryDisposition(prior.rows.map((row) => row.state));
      if (disposition === 'BLOCK_UNRESOLVED') {
        throw new ConflictException(
          'order already has an unresolved payment attempt; reconcile it before retrying',
        );
      }
      if (disposition === 'BLOCK_SETTLED') {
        throw new ConflictException('order payment is already settled');
      }

      await client.query(
        `INSERT INTO edge_payment_attempts(
           attempt_id,payment_id,event_id,order_id,client_attempt_id,
           initiation_idempotency_key,provider,amount_minor,currency,
           masked_payer_reference,state,reconciliation_required,cloud_seen,relay_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INITIATED',true,false,'PENDING')`,
        [
          input.attemptId,
          input.paymentId,
          input.eventId,
          input.orderId,
          input.clientAttemptId,
          input.idempotencyKey,
          input.provider,
          input.amountMinor,
          input.currency,
          maskEdgeMsisdn(input.payer.value),
        ],
      );
      return { row: await this.rowWithClient(client, input.attemptId), replay: false };
    });
  }

  private assertReplayMatches(row: EdgeAttemptRow, input: InitiatePaymentRequest): void {
    if (
      row.attempt_id !== input.attemptId ||
      row.payment_id !== input.paymentId ||
      row.event_id !== input.eventId ||
      row.order_id !== input.orderId ||
      row.client_attempt_id !== input.clientAttemptId ||
      row.provider !== input.provider ||
      row.amount_minor !== input.amountMinor.toString() ||
      row.currency !== input.currency
    ) {
      throw new ConflictException('payment idempotency key was reused with different content');
    }
  }

  private assertCloudSnapshotMatches(row: EdgeAttemptRow, cloud: PaymentAttemptSnapshot): void {
    if (
      cloud.attemptId !== row.attempt_id ||
      cloud.paymentId !== row.payment_id ||
      cloud.eventId !== row.event_id ||
      cloud.orderId !== row.order_id ||
      cloud.clientAttemptId !== row.client_attempt_id ||
      cloud.provider !== row.provider ||
      cloud.amountMinor.toString() !== row.amount_minor ||
      cloud.currency !== row.currency
    ) {
      throw new Error('Cloud payment response conflicts with Edge payment identity');
    }
  }

  private async applyCloudSnapshot(cloud: PaymentAttemptSnapshot): Promise<void> {
    await this.database.transaction(async (client) => {
      const current = await this.rowWithClient(client, cloud.attemptId, true);

      if (
        current.provider_request_id !== null &&
        cloud.providerRequestId !== null &&
        current.provider_request_id !== cloud.providerRequestId
      ) {
        await this.markProjectionConflict(client, current, 'CLOUD_PROVIDER_REQUEST_ID_CONFLICT');
        return;
      }
      if (
        current.provider_receipt_reference !== null &&
        cloud.providerReceiptReference !== null &&
        current.provider_receipt_reference !== cloud.providerReceiptReference
      ) {
        await this.markProjectionConflict(client, current, 'CLOUD_PROVIDER_RECEIPT_CONFLICT');
        return;
      }

      try {
        requirePaymentAttemptTransition(current.state, cloud.state);
      } catch {
        await this.markProjectionConflict(client, current, 'CLOUD_PAYMENT_STATE_CONFLICT');
        return;
      }

      await client.query(
        `UPDATE edge_payment_attempts SET
           state = $2,
           masked_payer_reference = COALESCE($3, masked_payer_reference),
           provider_request_id = COALESCE($4, provider_request_id),
           provider_receipt_reference = COALESCE($5, provider_receipt_reference),
           reconciliation_required = $6,
           cloud_seen = true,
           relay_status = 'ACKNOWLEDGED',
           last_relay_error = NULL,
           next_refresh_at = CASE WHEN $6 THEN clock_timestamp() + interval '5 seconds' ELSE NULL END,
           updated_at = clock_timestamp()
         WHERE attempt_id = $1`,
        [
          cloud.attemptId,
          cloud.state,
          cloud.maskedPayerReference,
          cloud.providerRequestId,
          cloud.providerReceiptReference,
          cloud.reconciliationRequired,
        ],
      );
    });
  }

  private async markProjectionConflict(
    client: PoolClient,
    current: EdgeAttemptRow,
    reason: string,
  ): Promise<void> {
    const unresolved = !this.isFinal(current.state);
    await client.query(
      `UPDATE edge_payment_attempts SET
         relay_status = 'UNAVAILABLE',
         last_relay_error = $2,
         reconciliation_required = CASE WHEN $3 THEN true ELSE reconciliation_required END,
         next_refresh_at = CASE
           WHEN $3 THEN clock_timestamp() + interval '5 seconds'
           ELSE NULL
         END,
         updated_at = clock_timestamp()
       WHERE attempt_id = $1`,
      [current.attempt_id, reason, unresolved],
    );
  }

  private async markCloudUnavailable(
    attemptId: string,
    reason = 'CLOUD_PAYMENT_UNAVAILABLE',
  ): Promise<void> {
    await this.database.query(
      `UPDATE edge_payment_attempts SET
         state = CASE WHEN cloud_seen = false AND state = 'INITIATED' THEN 'UNKNOWN' ELSE state END,
         reconciliation_required = CASE
           WHEN cloud_seen = false AND state = 'INITIATED' THEN true
           ELSE reconciliation_required
         END,
         relay_status = 'UNAVAILABLE',
         last_relay_error = $2,
         next_refresh_at = CASE
           WHEN state IN ('SUCCESS','FAILED','EXPIRED','REVERSED') THEN NULL
           ELSE clock_timestamp() + interval '5 seconds'
         END,
         updated_at = clock_timestamp()
       WHERE attempt_id = $1`,
      [attemptId, reason],
    );
  }

  private async getLocalAttempt(attemptId: string): Promise<PaymentAttemptSnapshot> {
    return this.snapshot(await this.row(attemptId));
  }

  private async row(attemptId: string): Promise<EdgeAttemptRow> {
    const rows = await this.database.query<EdgeAttemptRow>(
      `SELECT * FROM edge_payment_attempts WHERE attempt_id = $1`,
      [attemptId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('payment attempt not found');
    return row;
  }

  private async rowWithClient(
    client: PoolClient,
    attemptId: string,
    lock = false,
  ): Promise<EdgeAttemptRow> {
    const result = await client.query<EdgeAttemptRow>(
      `SELECT * FROM edge_payment_attempts WHERE attempt_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [attemptId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('payment attempt not found');
    return row;
  }

  private snapshot(row: EdgeAttemptRow): PaymentAttemptSnapshot {
    return {
      paymentId: row.payment_id,
      attemptId: row.attempt_id,
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

  private isFinal(state: PaymentAttemptState): boolean {
    return state === 'SUCCESS' || state === 'FAILED' || state === 'EXPIRED' || state === 'REVERSED';
  }
}
