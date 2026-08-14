from pathlib import Path

path = Path('apps/cloud-api/src/payments/payment.service.ts')
text = path.read_text()

old = """         AND a.provider_request_id IS NOT NULL
         AND (s.next_query_at IS NULL OR s.next_query_at <= clock_timestamp())
         AND (s.reconciliation_claimed_until IS NULL OR s.reconciliation_claimed_until < clock_timestamp())
       ORDER BY COALESCE(s.next_query_at, s.updated_at), s.updated_at
"""
new = """         AND a.provider_request_id IS NOT NULL
         AND s.next_query_at IS NOT NULL
         AND s.next_query_at <= clock_timestamp()
         AND (s.reconciliation_claimed_until IS NULL OR s.reconciliation_claimed_until < clock_timestamp())
       ORDER BY s.next_query_at, s.updated_at
"""
assert old in text, 'due query anchor missing'
text = text.replace(old, new, 1)

old = """        if (attempt.provider_request_id !== null) {
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
        const owner = await client.query<{ id: string }>(
"""
new = """        if (attempt.provider_request_id !== null) {
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
"""
assert old in text, 'request conflict anchor missing'
text = text.replace(old, new, 1)

old = """        if (owner.rowCount !== 0) {
          await this.exception(client, attemptId, attempt.provider, 'PROVIDER_REQUEST_ID_REUSED', {
            providerRequestId: input.providerRequestId,
            existingAttemptId: owner.rows[0]!.id,
          });
          return;
        }
"""
new = """        if (owner.rowCount !== 0) {
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
"""
assert old in text, 'request reuse anchor missing'
text = text.replace(old, new, 1)

old = """          await this.exception(client, attemptId, attempt.provider, 'PROVIDER_RECEIPT_CONFLICT', {
            currentReceiptReference: attempt.provider_receipt_reference,
            observedReceiptReference: input.providerReceiptReference,
          });
          return;
"""
new = """          await this.quarantineProviderConflict(
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
"""
assert old in text, 'receipt conflict anchor missing'
text = text.replace(old, new, 1)

old = """        if (attempt.provider_receipt_reference === null) {
          const owner = await client.query<{ id: string }>(
"""
new = """        if (attempt.provider_receipt_reference === null) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `payment-provider-receipt:${attempt.provider}:${input.providerReceiptReference}`,
          ]);
          const owner = await client.query<{ id: string }>(
"""
assert old in text, 'receipt lock anchor missing'
text = text.replace(old, new, 1)

old = """          if (owner.rowCount !== 0) {
            await this.exception(client, attemptId, attempt.provider, 'PROVIDER_RECEIPT_REUSED', {
              providerReceiptReference: input.providerReceiptReference,
              existingAttemptId: owner.rows[0]!.id,
            });
            return;
          }
"""
new = """          if (owner.rowCount !== 0) {
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
"""
assert old in text, 'receipt reuse anchor missing'
text = text.replace(old, new, 1)

anchor = """  private async scheduleQueryFailure(attemptId: string, reasonCode: string): Promise<void> {
"""
helper = """  private async quarantineProviderConflict(
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

"""
assert anchor in text, 'schedule helper anchor missing'
text = text.replace(anchor, helper + anchor, 1)

path.write_text(text)
