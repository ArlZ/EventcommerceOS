from pathlib import Path

root = Path('.')
path = root / 'apps/cloud-api/src/payments/payment.service.ts'
text = path.read_text()

unused = """interface AttemptStateRow extends QueryResultRow {
  state: PaymentAttemptState;
  reconciliation_required: boolean;
  next_query_at: Date | null;
}

"""
if unused not in text:
    raise SystemExit('unused type anchor missing')
text = text.replace(unused, '', 1)

old = """    if (created.idempotentReplay && created.attempt.dispatch_started_at !== null) {
      if (created.attempt.state === 'INITIATED') {
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
"""
new = """    if (created.idempotentReplay) {
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
"""
if old not in text:
    raise SystemExit('replay dispatch anchor missing')
text = text.replace(old, new, 1)

old = """      const existing = await this.attemptByIdempotency(client, input.idempotencyKey);
      if (existing) return { attempt: existing, idempotentReplay: true };

      await this.ensurePayment(client, input);
"""
new = """      const existing = await this.attemptByIdempotency(client, input.idempotencyKey);
      if (existing) return { attempt: existing, idempotentReplay: true };

      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `payment:${input.paymentId}`,
      ]);
      await this.ensurePayment(client, input);
"""
if old not in text:
    raise SystemExit('payment lock anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

for temporary in ['scripts/task006_orchestrator_repair.py', '.github/workflows/task006-orchestrator-repair.yml']:
    candidate = root / temporary
    if candidate.exists():
        candidate.unlink()
