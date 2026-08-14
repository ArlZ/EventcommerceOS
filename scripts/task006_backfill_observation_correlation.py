from pathlib import Path

path = Path('apps/cloud-api/src/payments/payment.service.ts')
text = path.read_text()
old = """        await client.query(`UPDATE payment_attempts SET provider_request_id = $2 WHERE id = $1`, [\n          attemptId,\n          input.providerRequestId,\n        ]);\n"""
new = """        await client.query(`UPDATE payment_attempts SET provider_request_id = $2 WHERE id = $1`, [\n          attemptId,\n          input.providerRequestId,\n        ]);\n        await client.query(\n          `UPDATE payment_provider_observations\n           SET attempt_id = $1\n           WHERE provider = $2 AND provider_request_id = $3 AND attempt_id IS NULL`,\n          [attemptId, attempt.provider, input.providerRequestId],\n        );\n"""
assert old in text, 'provider request assignment anchor not found'
text = text.replace(old, new, 1)
path.write_text(text)
