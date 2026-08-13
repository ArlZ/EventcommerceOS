# Payments Specification v0.1

## Principles

- The platform orchestrates payments; licensed/accredited providers handle payment rails.
- Raw card credentials must never pass through our application.
- Every payment creation request is idempotent.
- Provider callbacks are untrusted input until authenticated/validated.
- A delayed callback is not automatically a failed payment.
- Payment availability is independent from ordering availability.

## Payment abstraction

```text
PaymentProvider
  authorize/initiate()
  queryStatus()
  refund()
  reverse() where supported
  parseAndVerifyWebhook()
  capabilities()
```

Initial adapters may include:
- Safaricom M-PESA/Daraja;
- integrated card terminal provider;
- external/manual terminal reference;
- cash.

## Payment model

An `Order` has one or more `Payment` records. A `Payment` may have multiple `PaymentAttempt` records.

Never overwrite a failed attempt with a retry; preserve history.

## Idempotency

Suggested key pattern:

```text
PAYMENT:{order_id}:{payment_slot}:{client_attempt_id}
```

The server must return the original result when the same idempotency key is retried.

## M-PESA flow

1. POS creates payment attempt locally.
2. If provider rail is available, request is sent through adapter.
3. Status becomes `INITIATED`/`PENDING`.
4. Provider callback and/or explicit status query resolves truth.
5. POS/edge/cloud synchronize resulting payment event.
6. If truth cannot be determined safely, state becomes `UNKNOWN` and reconciliation begins.

Do not encourage repeated customer payment while the prior attempt is `PENDING`/`UNKNOWN` without explicit safe resolution.

## Card flow

Prefer certified smart terminals/acquirer integrations. Our system sends amount/reference and receives an approved/declined/provider reference result. Never store PAN/CVV/PIN.

## Independent fallback

Where an integrated API path is unavailable but a standalone terminal/till can take payment, allow a controlled `EXTERNAL_CONFIRMED` flow requiring provider reference/receipt metadata and later reconciliation.

## Refunds

Refunds are separate immutable records with:
- original payment link;
- amount;
- reason;
- requesting actor;
- approving actor if policy requires;
- provider reference;
- status.

## Payment failure-mode tests

- request timeout but provider succeeds;
- duplicate initiation request;
- duplicate webhook;
- webhook before client response;
- webhook ten minutes late;
- malformed webhook;
- forged webhook/signature failure;
- provider reports conflicting status;
- device loses connectivity while payment is pending;
- refund retry;
- reversal after apparent success.
