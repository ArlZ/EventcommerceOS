from pathlib import Path

path = Path('apps/cloud-api/src/payments/payment.service.ts')
text = path.read_text()

old = """      const existing = await this.attemptByIdempotency(client, input.idempotencyKey);\n      if (existing) {\n        this.assertIdempotentReplay(existing, input);\n        return { attempt: existing, idempotentReplay: true };\n      }\n\n      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [\n"""
new = """      const existing = await this.attemptByIdempotency(client, input.idempotencyKey);\n      if (existing) {\n        this.assertIdempotentReplay(existing, input);\n        return { attempt: existing, idempotentReplay: true };\n      }\n\n      const attemptIdentity = await client.query<{ id: string }>(\n        'SELECT id FROM payment_attempts WHERE id = $1',\n        [input.attemptId],\n      );\n      if (attemptIdentity.rowCount !== 0) {\n        throw new ConflictException('payment attempt ID was reused under a different idempotency key');\n      }\n\n      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [\n"""
assert old in text, 'createOrFind anchor missing'
text = text.replace(old, new, 1)

old = '      const attemptId = randomUUID();\n'
new = '      const attemptId = input.attemptId;\n'
assert text.count(old) == 1, f'expected one attempt id allocation, found {text.count(old)}'
text = text.replace(old, new, 1)

old = """    if (\n      existing.payment_id !== input.paymentId ||\n      existing.client_attempt_id !== input.clientAttemptId ||\n"""
new = """    if (\n      existing.id !== input.attemptId ||\n      existing.payment_id !== input.paymentId ||\n      existing.client_attempt_id !== input.clientAttemptId ||\n"""
assert old in text, 'idempotent replay anchor missing'
text = text.replace(old, new, 1)

path.write_text(text)
