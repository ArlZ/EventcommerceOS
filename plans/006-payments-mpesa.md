# Execution Plan 006 — Provider-Neutral Payments & M-PESA

## Goal

Build a replay-safe payment layer that preserves immutable payment-attempt history, keeps provider logic behind adapters, treats uncertain provider outcomes explicitly, and integrates Safaricom M-PESA/Daraja without introducing a cloud dependency into local order durability.

## Non-negotiable invariants

1. Payment-provider availability never determines whether an order can be created or preserved locally.
2. Money is integer minor units plus explicit currency; no floating-point money arithmetic.
3. Every retryable payment mutation is idempotent.
4. A Payment may have multiple immutable PaymentAttempt records; retries never overwrite prior attempts.
5. Provider timeout or missing callback is not automatically failure. Unresolved truth is `UNKNOWN` and enters reconciliation.
6. Provider callbacks are untrusted until parsed, schema-validated, correlated, and checked against the expected payment context.
7. Provider-specific code is isolated behind payment adapters; domain rules do not depend on Daraja.
8. Raw PAN/CVV/PIN and provider secrets never enter application persistence or logs.
9. Conflicting financial truth is never last-write-wins; it becomes an explicit reconciliation condition.
10. Refund/reversal history is append-only and attributable.

## Vertical slices

### 1. Payment domain

Add framework-independent payment attempt states, transition rules, immutable attempt representation, payment/refund/reversal primitives, provider capabilities, and idempotency helpers under `packages/domain`.

### 2. Shared contracts

Add provider-neutral payment initiation/status/update contracts suitable for POS -> Edge -> Cloud synchronization and Cloud -> Edge -> POS truth propagation.

### 3. Cloud payment persistence and orchestration

Add Cloud PostgreSQL schema and a Payments module for payments, attempts, provider events, reconciliation work, refunds/reversals, and durable provider interaction metadata.

### 4. Provider adapter boundary

Define an adapter interface for initiate, queryStatus, refund/reverse where supported, callback parsing/verification, and capabilities. Add a deterministic fake adapter for failure testing.

### 5. M-PESA / Daraja adapter

Implement sandbox-oriented OAuth and STK Push initiation plus status reconciliation using environment-provided configuration. No production credentials or provider secrets belong in source control.

### 6. Reconciliation

Persist unresolved attempts and reconcile them with bounded retry/backoff. A timeout enters `UNKNOWN`; later provider truth may resolve it. Exhausted automatic retries remain explicitly unresolved for operator reconciliation rather than becoming false failure.

### 7. Event Edge and POS synchronization

Extend existing durable sync mechanisms so local payment-attempt events can move POS -> Edge -> Cloud and authoritative payment-state updates can move back without losing unresolved state on restart or replay.

### 8. Operational payment health

Expose authorized Cloud read support for unknown attempts, provider latency/error signals, reconciliation age/value, and payment/refund/reversal history. Full Event Control UI is deferred.

## Failure-mode tests

Automate at minimum:

1. duplicate initiation -> one provider initiation/business effect;
2. duplicate sync/replay -> one payment attempt;
3. duplicate callback -> one transition;
4. callback before initiation response;
5. late callback;
6. request timeout but later provider success;
7. timeout -> `UNKNOWN`, never false failure;
8. reconciliation resolves `UNKNOWN`;
9. unresolved state survives restart/replay;
10. malformed/unknown/mismatched callback rejected;
11. provider conflicting status enters reconciliation conflict;
12. invalid state transition rejected;
13. refund retry has one business effect and preserves original payment;
14. provider outage leaves local ordering usable;
15. no secrets/prohibited card data are persisted or logged.

## Non-goals

- card-terminal integration;
- NFC/QR wallet;
- customer self-order;
- loyalty;
- production credentials/go-live;
- full Event Control dashboard;
- event-close settlement/reporting;
- payment-risk ML.

## Completion criteria

Task 006 is complete when payment attempts have explicit replay-safe state machines, provider initiation is idempotent, M-PESA is isolated behind the adapter boundary, provider uncertainty is durably reconciled rather than guessed, refunds/reversals preserve history, authoritative payment truth synchronizes safely, and the permanent repository gate plus payment failure-mode suite is green.
