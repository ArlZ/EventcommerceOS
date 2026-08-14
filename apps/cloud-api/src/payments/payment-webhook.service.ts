import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderWebhookInput,
  type ProviderWebhookObservation,
} from './payment-provider';

interface AttemptLookupRow extends QueryResultRow {
  id: string;
}

interface ObservationRow extends QueryResultRow {
  attempt_id: string | null;
  provider_request_id: string | null;
  normalized_outcome: string;
  verification_strength: string;
  payload_hash: string;
}

export interface WebhookIngestResult {
  duplicate: boolean;
  correlatedAttemptId: string | null;
  reconciliationRequested: boolean;
}

@Injectable()
export class PaymentWebhookService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async ingest(input: ProviderWebhookInput): Promise<WebhookIngestResult> {
    let observation: ProviderWebhookObservation;
    try {
      observation = await this.provider.parseAndVerifyWebhook(input);
    } catch {
      throw new BadRequestException('invalid payment provider callback');
    }
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `payment-observation:${this.provider.code}:${observation.observationKey}`,
      ]);

      const existing = await client.query<ObservationRow>(
        `SELECT attempt_id, provider_request_id, normalized_outcome,
                verification_strength, payload_hash
         FROM payment_provider_observations
         WHERE provider = $1 AND observation_key = $2`,
        [this.provider.code, observation.observationKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        if (!this.sameObservation(row, observation)) {
          await this.exception(client, row.attempt_id, 'WEBHOOK_OBSERVATION_KEY_REUSE', {
            observationKey: observation.observationKey,
          });
        }
        return {
          duplicate: true,
          correlatedAttemptId: row.attempt_id,
          reconciliationRequested: row.attempt_id !== null,
        };
      }

      const attemptId = await this.correlateAttempt(client, observation.providerRequestId);
      await client.query(
        `INSERT INTO payment_provider_observations(
           id, provider, observation_key, provider_request_id, attempt_id,
           observation_type, normalized_outcome, verification_strength,
           payload_hash, sanitized_details, received_at
         ) VALUES ($1,$2,$3,$4,$5,'WEBHOOK',$6,$7,$8,$9::jsonb,$10)`,
        [
          randomUUID(),
          this.provider.code,
          observation.observationKey,
          observation.providerRequestId,
          attemptId,
          observation.outcome,
          observation.verificationStrength,
          observation.payloadHash,
          JSON.stringify(observation.sanitizedDetails),
          input.receivedAt,
        ],
      );

      if (!attemptId) {
        await this.exception(client, null, 'UNKNOWN_PROVIDER_REQUEST_ID', {
          observationKey: observation.observationKey,
          providerRequestId: observation.providerRequestId,
        });
        return {
          duplicate: false,
          correlatedAttemptId: null,
          reconciliationRequested: false,
        };
      }

      // M-PESA callback correlation is not treated as cryptographic payment truth.
      // Persist the observation and wake the authenticated outbound status query.
      await client.query(
        `UPDATE payment_attempt_state SET
           reconciliation_required = true,
           next_query_at = clock_timestamp(),
           updated_at = clock_timestamp()
         WHERE attempt_id = $1
           AND state IN ('INITIATED','PENDING','UNKNOWN')`,
        [attemptId],
      );

      return {
        duplicate: false,
        correlatedAttemptId: attemptId,
        reconciliationRequested: true,
      };
    });
  }

  private async correlateAttempt(
    client: PoolClient,
    providerRequestId: string | null,
  ): Promise<string | null> {
    if (!providerRequestId) return null;
    const result = await client.query<AttemptLookupRow>(
      `SELECT id FROM payment_attempts
       WHERE provider = $1 AND provider_request_id = $2`,
      [this.provider.code, providerRequestId],
    );
    return result.rows[0]?.id ?? null;
  }

  private sameObservation(row: ObservationRow, observation: ProviderWebhookObservation): boolean {
    return (
      row.provider_request_id === observation.providerRequestId &&
      row.normalized_outcome === observation.outcome &&
      row.verification_strength === observation.verificationStrength &&
      row.payload_hash === observation.payloadHash
    );
  }

  private async exception(
    client: PoolClient,
    attemptId: string | null,
    exceptionType: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_reconciliation_exceptions(
         id, attempt_id, provider, exception_type, sanitized_details
       ) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [randomUUID(), attemptId, this.provider.code, exceptionType, JSON.stringify(details)],
    );
  }
}
