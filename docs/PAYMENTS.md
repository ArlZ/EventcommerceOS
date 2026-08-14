# Payments Specification v0.2

## Principles

- The platform orchestrates payments; licensed/accredited providers handle payment rails.
- Raw card credentials must never pass through our application.
- Every payment creation request is idempotent.
- Provider callbacks are untrusted input until parsed, validated and correlated.
- A delayed callback, timeout or missing callback is not automatically a failed payment.
- Payment availability is independent from ordering availability.
- Conflicting financial truth is reconciled explicitly; money is never last-write-wins.

## Payment abstraction

```text
PaymentProvider
  initiate()
  queryStatus()
  refund()
  reverse() where supported
  parseAndVerifyWebhook()
  capabilities()
```

Provider-specific code remains at the Cloud infrastructure boundary. The POS and Event Edge exchange provider-neutral payment-attempt state.

Initial and planned adapters include:
- Safaricom M-PESA/Daraja — Task 006;
- integrated card terminal provider — later slice;
- external/manual terminal reference — later slice;
- cash — existing local flow.

## Payment model

An `Order` has one or more `Payment` records. A `Payment` may have multiple immutable `PaymentAttempt` records.

Attempt states are explicit:

```text
CREATED -> INITIATED/PENDING -> SUCCEEDED/FAILED
                         \-> UNKNOWN -> PENDING/SUCCEEDED/FAILED
```

Terminal success/failure cannot silently overwrite one another. A retry never replaces an earlier attempt.

Money is integer minor units with an explicit three-letter currency code.

## Idempotency and crash safety

Key pattern:

```text
PAYMENT:{order_id}:{payment_slot}:{client_attempt_id}
```

Cloud persists the payment and `CREATED` attempt before provider initiation. Replaying a completed idempotency key returns the original business effect.

A particularly dangerous case is a process crash after a provider request may have been transmitted but before its result is persisted. If a retry finds the durable attempt still in ambiguous `CREATED` state, the system does not blindly send a second provider request. It moves the attempt to `UNKNOWN`/reconciliation instead.

## M-PESA flow

1. POS creates the payment attempt in Room and writes its outbox event in the same local transaction.
2. The order becomes `PAYMENT_PENDING`; item edits, cash close and starting a second order are blocked while provider truth is unresolved.
3. The customer phone is sent transiently over HTTPS to Event Edge and onward to Cloud; it is not stored in the POS payment entity, POS outbox or Edge payment cache.
4. Cloud invokes the M-PESA adapter.
5. A successful initiation produces `PENDING`; transport ambiguity produces `UNKNOWN`.
6. M-PESA callbacks are schema-validated, correlated and deduplicated, but are treated as reconciliation signals rather than sufficient settlement truth on their own.
7. Cloud uses the provider status-query path to resolve authoritative payment truth.
8. The resolved provider-neutral state returns Edge -> POS. `SUCCEEDED` closes the same local order; definitive `FAILED` reopens it for another payment decision.

Do not encourage or automatically initiate another customer payment while the prior attempt is `PENDING` or `UNKNOWN`.

## UNKNOWN reconciliation

`UNKNOWN` is a durable business state, not an error placeholder.

Cloud reconciliation:
- stores an explicit reconciliation job;
- queries provider status when a provider reference exists;
- retries with bounded exponential backoff;
- resolves automatically when provider truth becomes clear;
- moves unresolved or conflicting cases to manual review rather than inventing failure.

Operational health exposes unknown attempt count, value and age.

## M-PESA configuration

M-PESA configuration is supplied only through runtime environment/configuration. No production secrets belong in source control.

Supported settings include:
- `MPESA_BASE_URL` (sandbox by default);
- `MPESA_CONSUMER_KEY`;
- `MPESA_CONSUMER_SECRET`;
- `MPESA_BUSINESS_SHORT_CODE`;
- `MPESA_PASSKEY`;
- `MPESA_CALLBACK_URL`;
- `MPESA_TRANSACTION_TYPE`;
- `MPESA_TIMEOUT_MS`.

Production credentials and live-rail validation are deployment concerns, not CI fixtures.

## Card flow

Prefer certified smart terminals/acquirer integrations. Our system sends amount/reference and receives an approved/declined/provider-reference result. Never store PAN/CVV/PIN.

Card-terminal integration is intentionally outside Task 006.

## Independent fallback

Where an integrated API path is unavailable but a standalone terminal/till can take payment, a later controlled `EXTERNAL_CONFIRMED` flow may record provider reference/receipt metadata with audit and reconciliation controls.

There must not be a generic unaudited manual-success button.

## Refunds and reversals

Refunds/reversals are separate immutable records with:
- original payment link;
- integer amount and currency;
- reason;
- requesting actor;
- approving actor where policy requires;
- provider reference;
- idempotency key;
- explicit status.

Task 006 establishes the provider-neutral records and capability boundary. Provider execution is implemented only where a provider safely supports it; original financial history is never overwritten.

## Operational signals

Minimum payment signals include:
- initiation volume;
- success and definitive failure;
- pending/unknown count;
- unknown payment value and age;
- provider latency/error rate;
- callback rejects/duplicates;
- reconciliation resolutions and manual-review backlog.

Logs use correlation/order/payment/attempt identifiers and must not contain provider secrets, raw card credentials or full customer payment identifiers.

## Payment failure-mode tests

- duplicate initiation request;
- ambiguous retry after possible provider transmission;
- duplicate callback;
- callback before initiation response;
- delayed callback;
- request timeout but provider later succeeds;
- malformed callback;
- callback amount/reference mismatch;
- provider reports conflicting status;
- device/Edge loses connectivity while payment is pending;
- POS/Edge/Cloud restart with unresolved payment;
- refund retry;
- reversal after apparent success;
- provider outage while local ordering remains usable.
