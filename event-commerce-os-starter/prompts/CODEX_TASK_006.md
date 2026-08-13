# Codex Task 006 — Payment Domain + M-PESA Integration

Read `AGENTS.md`, `docs/PAYMENTS.md`, relevant security/reliability docs and current Safaricom official developer documentation before implementation. Do not rely on remembered API details.

## Objective

Implement the provider-neutral payment domain and the first M-PESA adapter using the provider's supported sandbox/test environment.

## Domain first

Before provider code, implement:
- `Payment` and immutable `PaymentAttempt` history;
- explicit attempt state machine;
- idempotent initiation API;
- provider adapter interface;
- provider capability model;
- reconciliation/query job;
- webhook verification/parsing boundary;
- `UNKNOWN` state handling.

## M-PESA

Implement the smallest production-shaped integration needed for POS-initiated customer payment, using current official APIs and sandbox credentials supplied through environment configuration.

Never hard-code secrets or put provider-specific concepts into the core Order domain.

## POS UX

Payment screen must clearly distinguish:
- initiating;
- waiting for customer/provider;
- success;
- failed;
- unknown/reconciliation required.

Do not encourage an unsafe immediate retry while prior provider truth is unresolved.

## Failure tests

- same idempotency key submitted repeatedly;
- provider accepts but HTTP response times out;
- callback arrives before initiating request returns;
- callback duplicated;
- callback delayed;
- invalid/forged callback;
- device disconnect while pending;
- query resolves unknown to success;
- explicit safe retry creates a new attempt without overwriting history.

## Security review

At task completion run a targeted review for:
- secrets leakage;
- PII in logs;
- webhook trust errors;
- duplicate charge paths;
- insecure retry behaviour.
