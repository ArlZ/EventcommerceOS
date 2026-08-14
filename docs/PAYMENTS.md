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

Cloud persists the payment and `CREATED` attempt before provider initiation. Replaying the same idempotency key returns the existing durable attempt and never steals ownership of an in-flight provider call.

A particularly dangerous case is a process crash after a provider request may have been transmitted but before its result is persisted. An immediate concurrent/retry request must not mutate the shared `CREATED` attempt because the original owner may still be waiting for the provider. Instead, a stale-`CREATED` watchdog treats an attempt that remains unresolved beyond the initiation safety window as `UNKNOWN`/manual review. It is never blindly re-initiated.

## M-PESA flow

1. POS creates the payment attempt in Room and writes its outbox event in the same local transaction.
2. The order becomes `PAYMENT_PENDING`; item edits, cash close and starting a second order are blocked while provider truth is unresolved.
3. The customer phone is sent transiently over HTTPS to Event Edge and onward to Cloud; it is not stored in the POS payment entity, POS outbox or Edge payment cache.
4. Cloud invokes the M-PESA adapter.
5. A successful initiation produces `PENDING`; transport ambiguity produces `UNKNOWN`.
6. M-PESA callbacks are schema-validated, correlated and deduplicated, but are treated as reconciliation signals rather than sufficient settlement truth on their own.
7. Cloud uses the provider status-query path to resolve authoritative payment truth. `PENDING` and `UNKNOWN` attempts remain scheduled for bounded reconciliation even if no callback arrives.
8. Event Edge applies legal payment-state transitions rather than last-write-wins; terminal truth cannot be regressed by a late response, and conflicting provider references force explicit uncertainty.
9. The resolved provider-neutral state returns Edge -> POS. `SUCCEEDED` closes the same local order; definitive `FAILED` reopens it for another payment decision.

Do not encourage or automatically initiate another customer payment while the prior attempt is `PENDING` or `UNKNOWN`.

## UNKNOWN reconciliation

`UNKNOWN` is a durable business state, not an error placeholder.

Cloud reconciliation:
- stores an explicit reconciliation job;
- queries provider status when a provider reference exists;
- also polls durable `PENDING`/`INITIATED` attempts when callback delivery is absent;
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

Refunds/reversals are separate durable records with immutable intent fields:
- original payment link;
- provider and original provider transaction reference;
- integer amount and currency;
- reason;
- requesting actor;
- approving actor where policy requires;
- idempotency key;
- explicit processing status and resulting provider reference/failure code.

The original payment/attempt history is never overwritten. Cloud serializes adjustments against the original payment and reserves all non-failed refund/reversal value, so concurrent adjustments cannot cumulatively exceed the paid amount.

The same adjustment idempotency key never invokes the provider twice. If a provider call may have been transmitted but its result is not durably recorded, a later stale retry becomes `UNKNOWN` rather than issuing another refund/reversal. A failed adjustment requires a new explicit adjustment intent/idempotency key.

Provider execution is capability-gated. Task 006 supplies the generic orchestration boundary; the M-PESA adapter does not claim refund/reversal support unless that provider path is explicitly implemented and validated.

## Authorization boundary

Payment mutation and operational-read endpoints must ultimately sit behind the platform authentication/RBAC layer defined in `SECURITY_RELIABILITY.md`. Task 006 does not invent a payment-specific shared-secret mechanism because device identity, access tokens, RBAC and supervisor approval are cross-cutting platform controls. Deployment must not expose these internal endpoints publicly before that baseline is wired through the application stack.

The M-PESA callback route is necessarily provider-facing and therefore uses provider-specific validation/reconciliation rules rather than operator authorization.

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
- simultaneous duplicate initiation while the owner is in flight;
- stale ambiguous initiation after possible provider transmission;
- duplicate callback;
- callback before initiation response;
- delayed callback;
- request timeout but provider later succeeds;
- malformed callback;
- callback amount/reference mismatch;
- provider reports conflicting status;
- pending attempt with no callback;
- stale Edge response after terminal success;
- device/Edge loses connectivity while payment is pending;
- POS/Edge/Cloud restart with unresolved payment;
- refund retry, including an in-flight duplicate;
- reversal replay and over-adjustment prevention;
- provider outage while local ordering remains usable.
