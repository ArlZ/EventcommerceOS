# Execution Plan 006 — Payment Domain + M-PESA

## Goal

Build a provider-neutral, idempotent payment engine whose first rail is Safaricom M-PESA Express, while preserving the core event invariant that payment-provider or internet failure may degrade a payment rail but must never freeze order building or silently create a duplicate charge.

## Provider documentation basis

Implementation must be checked against current Safaricom-owned sources before provider code is accepted. As of 14 August 2026, Safaricom's Daraja 3.0 developer portal still exposes M-PESA Express and a sandbox/test workflow; Safaricom's M-PESA business documentation identifies Lipa na M-PESA Online plus its query API as supported integration capabilities. The official Safaricom SDKs are supplementary implementation references only; remembered/third-party endpoint behaviour is not authoritative.

If the current M-PESA Express callback contract does not document a cryptographic authenticity mechanism, callback payloads are treated as untrusted observations: schema-validate, correlate to an existing attempt, persist the observation, and require provider query/reconciliation before promoting an unresolved attempt to final `SUCCESS`. Do not invent signature verification that Safaricom does not document.

## Non-negotiable invariants

1. Money is integer minor units plus explicit currency. No floating-point money.
2. `Payment` and each `PaymentAttempt` have stable identities. A retry creates a new attempt; it never rewrites a failed/expired/unknown attempt into a different attempt.
3. Every attempt transition is append-only/auditable and has source, timestamp and idempotency identity.
4. Same initiation idempotency key returns the same attempt/result and can never call the provider twice.
5. Provider timeout after request transmission is not `FAILED`; use `UNKNOWN` until reconciled.
6. A `PENDING` or `UNKNOWN` attempt blocks casual customer retry. A new attempt requires an explicit safe-retry decision after prior-provider truth is resolved or policy explicitly permits it.
7. Provider callbacks are untrusted until verified/correlated according to the documented provider capability. Duplicate and late callbacks are replay-safe.
8. No raw PAN/CVV/PIN or M-PESA PIN enters our application, database or logs. Phone identifiers are minimized/redacted in logs.
9. Provider secrets are environment/secret-store configuration only. Never persist or log consumer secret, passkey, access token or generated password.
10. Order building remains locally available when Cloud/provider is unavailable. Payment rail availability is separate from ordering availability.
11. Only confirmed successful payment may cause a non-cash order to transition to paid/closed. `UNKNOWN` never closes an order.
12. Inventory depletion is driven exactly once by the resulting order-close event; payment callbacks themselves never mutate inventory.

## Payment states

Core attempt states:

`INITIATED -> PENDING -> SUCCESS`

with explicit alternatives:

- `INITIATED -> FAILED | UNKNOWN`
- `PENDING -> FAILED | EXPIRED | UNKNOWN | SUCCESS`
- `UNKNOWN -> PENDING | FAILED | EXPIRED | SUCCESS`
- `SUCCESS -> REVERSED` where supported and explicitly initiated

`FAILED`, `EXPIRED` and `REVERSED` are terminal for that attempt. A subsequent customer payment is a new immutable attempt.

A provider response that means only "accepted for processing" maps to `PENDING`, never `SUCCESS`.

## Vertical slices

### 1. Framework-independent payment domain

Add pure rules under `packages/domain` and contracts under `packages/contracts` for:
- payment/attempt identifiers;
- explicit state transitions;
- retry eligibility;
- provider capability model;
- initiation/query/webhook normalized results;
- integer amount/currency validation;
- provider observation/result provenance.

No Daraja field names belong in the core domain.

### 2. Cloud payment persistence + orchestration

Add Cloud PostgreSQL schema for:
- `payments` linked to order/event/amount/currency;
- `payment_attempts` with immutable provider request identity and current projection;
- append-only `payment_attempt_transitions`;
- initiation idempotency registry/unique key;
- provider observations/webhook inbox with replay identity;
- reconciliation scheduling (`next_query_at`, attempts, last error);
- reconciliation exceptions/conflicting provider truth.

Payment initiation transaction creates the local attempt before provider I/O. Provider I/O occurs outside the database transaction. The provider result is then applied through the same transition/idempotency boundary used by reconciliation/webhooks.

If the process dies after provider acceptance but before the response is persisted, the durable pre-provider attempt remains reconcilable rather than becoming a second initiation candidate.

### 3. Provider adapter boundary

`PaymentProvider` must expose normalized operations/capabilities such as:
- `initiate()`;
- `queryStatus()`;
- `parseAndVerifyWebhook()` (verification strength is provider capability, not assumed);
- `reverse()`/`refund()` only if supported by this task/provider capability;
- `capabilities()`.

Adapters cannot update payment tables directly.

### 4. Safaricom M-PESA Express adapter

Implement the smallest production-shaped M-PESA Express integration supported by current official Daraja documentation:
- OAuth/access-token acquisition and expiry-aware in-memory caching;
- sandbox/production base URL from explicit environment mode;
- M-PESA Express initiation;
- M-PESA Express query/status reconciliation;
- strict response/callback schemas;
- provider request IDs stored for correlation;
- timeouts/transport ambiguity mapped to `UNKNOWN` when the request may have reached Safaricom;
- no secret/provider payload dumping to logs.

Required environment values are validated at startup of the adapter, but no real credential is committed. CI uses deterministic fake HTTP transports; optional sandbox smoke tests run only when sandbox secrets are deliberately supplied.

### 5. Webhook + reconciliation truth

Cloud exposes a narrow provider webhook endpoint. The raw request is size-limited and schema-validated. The adapter returns a normalized observation plus verification/correlation strength.

Duplicate observations are idempotent. Unknown provider request IDs do not create payments. Conflicting provider truth creates a reconciliation exception rather than last-write-wins.

A background reconciliation worker queries `PENDING`/`UNKNOWN` attempts on bounded schedules with exponential backoff/jitter and provider rate protection. One poison attempt cannot block the batch.

### 6. Event Edge payment relay/status cache

Event Edge exposes an event-local payment API to the POS and relays provider-dependent work to Cloud. Edge does not contain Daraja secrets. It stores enough attempt/status identity to survive Cloud disconnection and return explicit `UNKNOWN/unavailable` states without blocking local order creation.

Cloud unavailability must never convert an unresolved payment into `FAILED` or encourage immediate repeat charge.

### 7. Android POS durable payment UX

Add Room-backed local payment attempt state so app/process restart restores a pending/unknown payment screen.

UX states:
- initiating;
- waiting for M-PESA/customer;
- success;
- failed/expired;
- unknown — reconciliation required.

A pending/unknown attempt disables ordinary "Pay again". Explicit safe retry is separate and creates a new client-attempt ID after reconciliation policy permits it.

On confirmed `SUCCESS`, close the order locally in the same Room transaction as the successful payment projection/outbox event. Do not put provider-specific fields into the Order domain. The order-close event remains the sole inventory-depletion trigger.

## Failure-mode suite

Automate at minimum:
1. repeated initiation with the same idempotency key -> one provider call/one attempt;
2. provider accepted request but HTTP response times out -> `UNKNOWN`, never `FAILED`;
3. process/provider callback races initiation response;
4. duplicate callback/observation -> one transition;
5. delayed callback after `UNKNOWN`;
6. malformed/forged/unverifiable callback cannot create `SUCCESS` by itself;
7. callback for unknown provider request ID cannot create a payment;
8. device disconnect/restart while pending restores local pending state;
9. query resolves `UNKNOWN -> SUCCESS` exactly once;
10. provider reports conflicting terminal truth -> reconciliation exception;
11. explicit safe retry creates a new immutable attempt and preserves prior history;
12. Cloud/provider outage leaves order-building path responsive;
13. successful payment closes order once and produces one inventory-depletion source event;
14. secrets/phone identifiers are absent from structured logs and stored provider observations are minimized.

## Security review

Before merge review:
- secret/config scanning;
- logs and exception payloads for PII/secrets;
- webhook authenticity/correlation assumptions against current Safaricom docs;
- duplicate-charge paths across timeout/restart/retry races;
- unsafe `PENDING/UNKNOWN` retry UX;
- provider IDs/idempotency uniqueness under concurrency;
- no payment callback directly changes inventory/order truth without orchestration.

## Non-goals

- card/acquirer integration (Task 007);
- production M-PESA credentials committed to the repository;
- production refunds unless explicitly required by the current M-PESA Task 006 acceptance criteria;
- wallet/prepaid wristband support;
- loyalty;
- automatic retry of a customer charge while provider truth is unresolved.

## Completion criteria

Task 006 is complete when the provider-neutral domain, Cloud persistence/orchestration, Daraja sandbox-shaped adapter, webhook/query reconciliation, Edge relay, and durable POS payment UX pass the full Task 001–005 regression suite plus the payment failure-mode suite, and an adversarial security review finds no duplicate-charge, secret-leakage, forged-callback or unsafe-retry path.
