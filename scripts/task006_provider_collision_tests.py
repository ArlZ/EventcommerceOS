from pathlib import Path

path = Path('apps/cloud-api/test/payment-orchestration.integration.test.ts')
text = path.read_text()
anchor = """  it('does not let one provider receipt settle two different payments', async () => {
"""
insert = """  it('quarantines reuse of one provider request ID across different payments', async () => {
    provider.fixedRequestId = 'SHARED-CHECKOUT';
    const first = await payments.initiate(requestInput());
    expect(first.attempt.state).toBe('PENDING');

    const second = await payments.initiate(
      requestInput({
        eventId: 'payment-event-002',
        orderId: 'payment-order-002',
        paymentId: 'payment-002',
        attemptId: 'attempt-002',
        clientAttemptId: 'client-attempt-002',
        idempotencyKey: 'PAYMENT:payment-order-002:full:client-attempt-002',
      }),
    );

    expect(second.attempt.state).toBe('UNKNOWN');
    expect(second.attempt.providerRequestId).toBeNull();
    expect(second.attempt.reconciliationRequired).toBe(true);
    const exceptions = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payment_reconciliation_exceptions
       WHERE attempt_id = 'attempt-002' AND exception_type = 'PROVIDER_REQUEST_ID_REUSED'`,
    );
    expect(exceptions[0]!.count).toBe('1');
    expect(await payments.dueAttemptIds()).not.toContain('attempt-002');
  });

"""
assert anchor in text, 'receipt test anchor missing'
text = text.replace(anchor, insert + anchor, 1)

old = """    expect((await payments.getAttempt(second.attempt.attemptId)).state).not.toBe('SUCCESS');
    const exceptions = await database.query<{ count: string }>(
"""
new = """    expect((await payments.getAttempt(second.attempt.attemptId)).state).toBe('UNKNOWN');
    expect(await payments.dueAttemptIds()).not.toContain(second.attempt.attemptId);
    const exceptions = await database.query<{ count: string }>(
"""
assert old in text, 'receipt expectation anchor missing'
text = text.replace(old, new, 1)
path.write_text(text)
