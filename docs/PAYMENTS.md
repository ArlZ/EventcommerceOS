# Payments Specification v0.3

## Principles

- The platform orchestrates payments; licensed/accredited providers handle payment rails.
- Raw card credentials must never pass through our application interfaces or persistence.
- Every payment creation request is idempotent.
- Provider callbacks are untrusted input until authenticated, parsed, validated, independently verified where required, and correlated.
- A delayed callback, timeout or missing callback is not automatically a failed payment.
- Payment availability is independent from ordering availability.
- Conflicting financial truth is reconciled explicitly; money is never last-write-wins.
- Provider-specific payloads, credentials and status semantics stay inside provider adapters.

## Payment abstraction

```text
PaymentProvider
  initiate()
  queryStatus()
  refund()
  reverse() where supported
  parseAndVerifyWebhook()
  capabilities()
  availability() where exposed
```

Provider-specific code remains at the Cloud infrastructure boundary. The POS and Event Edge exchange provider-neutral payment-attempt state.

Implemented adapters include:
- Safaricom M-PESA/Daraja — `mpesa`;
- Pesapal Sabi wireless POS notification + verification — `pesapal_sabi`;
- controlled standalone/external terminal fallback — `external_terminal`;
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

## Pesapal Sabi card flow

Task 007 implements the **public, documented Pesapal Sabi wireless POS surface**. It does not invent the access-restricted Sabi wired API.

The current operational flow is:

1. POS creates a durable `pesapal_sabi` payment attempt and the order enters `PAYMENT_PENDING`.
2. The POS displays the immutable `paymentAttemptId` as the merchant reference to use on Sabi. Pesapal documents that a reference may be added to a Sabi charge before the amount so the transaction can be reconciled to the merchant's records.
3. The cashier performs the card transaction on the certified Pesapal terminal. PAN, CVV/CVC, PIN, track data, EMV payloads and cryptograms remain on the terminal/provider side and are not collected by Event Commerce OS.
4. For a completed transaction, Pesapal sends the configured HTTPS notification endpoint the documented transaction payload including amount, payment option, currency, `merchant_reference` and `confirmation_code`.
5. Cloud validates the documented `Consumerkey` and `Consumersecret` notification headers before accepting the signal.
6. Cloud independently calls Pesapal's documented transaction-verification endpoint using the `confirmation_code` and `APIKey`. The verification response is treated as the final source of truth.
7. The adapter compares verified merchant reference, amount and currency to the immutable payment attempt. Any mismatch becomes `UNKNOWN`/manual review; it is never silently applied.
8. A verified completed transaction becomes `SUCCEEDED` and retains the Pesapal confirmation code as the provider reference. Duplicate notifications have one business effect.
9. Event Edge and POS receive the same provider-neutral attempt truth. A late/stale Edge response cannot regress terminal truth.

Public Pesapal references used for this implementation:
- Sabi wireless notification and verification API: `https://developer.pesapal.com/how-to-integrate/point-of-sale/wireless-connection`
- Sabi POS API reference and wired-access restriction: `https://developer.pesapal.com/how-to-integrate/point-of-sale/api-reference`
- Sabi wired restriction page: `https://developer.pesapal.com/how-to-integrate/point-of-sale/pos-wired-connection`
- adding a Sabi transaction reference: `https://www.pesapal.com/support/point-of-sale-sabi/how-to-add-a-reference-on-sabi`

### Public-wireless limitation

Pesapal's public wireless documentation describes the notification as being sent after a completed payment. It does not publish a POS-driven command/decline contract for the access-restricted wired API. Therefore this repository does **not** fabricate a wired initiation call, terminal SDK, decline code or local protocol.

A reference-less Sabi attempt that the physical terminal visibly declines may be closed as `FAILED` only through the supervised manual-evidence path described below. Manual approval is never permitted for an integrated Sabi attempt. If a delayed verified Sabi success later conflicts with that supervised decline record, the payment is forced into manual review rather than silently overwriting either truth source.

## Pesapal Sabi configuration

Runtime-only settings:
- `PESAPAL_SABI_WEBHOOK_CONSUMER_KEY`;
- `PESAPAL_SABI_WEBHOOK_CONSUMER_SECRET`;
- `PESAPAL_SABI_API_KEY`;
- `PESAPAL_SABI_VERIFY_URL` (defaults to the documented Pesapal verification endpoint);
- `PESAPAL_SABI_TIMEOUT_MS`.

Production setup also requires Pesapal merchant/terminal provisioning, an SSL-secured notification URL, verification API key provisioning and IP whitelisting as required by Pesapal. Those deployment credentials and approvals do not belong in source control.

### Wired Sabi integration gate

Pesapal documents that wired Sabi APIs/assets are restricted. Full POS-driven terminal initiation is therefore **not implemented** in this repository until Pesapal grants access to the official restricted documentation/API assets. When access is granted, the wired implementation must stay behind the existing `PaymentProvider` boundary and preserve the same idempotency/reconciliation/card-data invariants.

## Card-data boundary

Event Commerce OS accepts references and normalized payment truth, not raw card credentials.

The payment HTTP boundaries reject prohibited raw card-field names including PAN/card number, CVV/CVC, PIN, track/magstripe data, EMV blobs and cryptograms. Shared contracts, Event Edge cache, Android Room entities and payment outbox events contain no fields for that data.

This architecture reduces the application's exposure to cardholder data, but **this document does not claim that Event Commerce OS is PCI DSS compliant or that a deployment is automatically out of PCI scope**. PCI obligations depend on the selected provider, terminal, network, merchant setup and deployment architecture and must be assessed with the acquirer/provider and appropriate compliance specialists.

## Controlled external/manual terminal fallback

Where a standalone terminal can take payment but no integrated provider result is available, the platform supports a dedicated `external_terminal` payment attempt.

Manual confirmation requires:
- a dedicated immutable confirmation id;
- an idempotency key;
- exact payment attempt, amount and currency match;
- external terminal/provider identifier;
- non-empty external transaction/receipt reference;
- requesting/confirming actor identity;
- reason;
- explicit `APPROVED` or `DECLINED` outcome;
- event-level `PAYMENT_MANUAL_CONFIRM` permission;
- append-only audit evidence.

A manual `APPROVED` outcome can only resolve a dedicated `external_terminal` attempt. It can never turn an integrated M-PESA/Sabi attempt into success.

For the Sabi public-wireless decline gap, a supervisor may record `DECLINED` evidence only while the `pesapal_sabi` attempt has no provider confirmation reference and is not already `UNKNOWN`/terminal. The evidence reference is stored in the immutable manual-confirmation record, not masqueraded as a Pesapal confirmation code. A later verified success creates `CONFLICTING_PROVIDER_TRUTH` manual review.

An `UNKNOWN` attempt must be reconciled before any manual terminal fallback is used. There is no generic unaudited manual-success button.

The Event Edge exposes the controlled confirmation route as well as Cloud so event-side operations do not need to bypass Edge.

## UNKNOWN reconciliation

`UNKNOWN` is a durable business state, not an error placeholder.

Cloud reconciliation:
- stores an explicit reconciliation job;
- queries provider status when a provider reference exists and the adapter supports status query;
- also polls durable `PENDING`/`INITIATED` attempts where appropriate;
- retries with bounded exponential backoff;
- resolves automatically when provider truth becomes clear;
- moves unresolved or conflicting cases to manual review rather than inventing failure.

For Sabi wireless, the confirmation code received from the notification becomes the status-query/provider reference. Before that code exists, there is no documented public Pesapal transaction-verification key to poll.

Operational health exposes unknown attempt count, value and age.

## Payment rail availability

Payment-rail availability is independent of local POS availability.

Cloud exposes provider configuration/availability separately at:

```text
GET /payments/providers/availability
```

Event Edge proxies the same operational view. If Cloud payment health itself is unreachable, Edge marks known electronic/manual rails `DEGRADED`; this does not mark the POS or local ordering path unavailable.

A provider outage must not prevent building and durably storing local orders. It only affects whether a particular payment rail can be completed/reconciled.

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

Provider execution is capability-gated. The generic orchestration boundary does not make an adapter claim refund/reversal support unless that provider path is explicitly implemented and validated.

## Authorization boundary

Payment mutation and operational-read endpoints must ultimately sit behind the platform authentication/RBAC layer defined in `SECURITY_RELIABILITY.md`. Task 007 adds a durable event-level permission check and audit evidence for manual terminal confirmation, but it does not invent a parallel payment-only authentication system. Device identity, operator sessions, access tokens and broader RBAC remain cross-cutting platform controls.

Deployment must not expose internal payment mutation/read endpoints publicly before that baseline is wired through the application stack.

Provider callback routes are necessarily provider-facing and therefore use provider-specific authentication/verification/reconciliation rules rather than operator authorization.

## Operational signals

Minimum payment signals include:
- initiation volume;
- success and definitive failure;
- pending/unknown count;
- unknown payment value and age;
- provider/rail availability;
- provider latency/error rate;
- callback authentication rejects/duplicates;
- reconciliation resolutions and manual-review backlog;
- manual terminal confirmations/declines and actor/reference audit evidence.

Logs use correlation/order/payment/attempt identifiers and must not contain provider secrets, raw card credentials or full customer payment identifiers.

## Payment failure-mode tests

- duplicate initiation request;
- simultaneous duplicate initiation while the owner is in flight;
- stale ambiguous initiation after possible provider transmission;
- duplicate callback;
- callback before initiation response;
- delayed callback;
- request/verification timeout but provider later succeeds;
- malformed/unauthenticated callback;
- callback amount/reference mismatch;
- provider reports conflicting status;
- pending attempt with no callback;
- Sabi callback correlates before provider reference exists;
- Sabi supervised decline evidence followed by delayed verified success;
- stale Edge response after terminal success;
- device/Edge loses connectivity while payment is pending;
- POS/Edge/Cloud restart with unresolved payment;
- manual fallback permission denied;
- manual confirmation idempotent replay and immutable audit;
- manual approval rejected for an integrated Sabi attempt;
- prohibited card fields rejected at Cloud and Edge boundaries and absent from durable POS payloads;
- refund retry, including an in-flight duplicate;
- reversal replay and over-adjustment prevention;
- provider outage while local ordering remains usable.
