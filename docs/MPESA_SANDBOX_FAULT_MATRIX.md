# M-PESA / Daraja controlled sandbox fault matrix

This runbook is the **real provider evidence** complement to the automated M-PESA adapter tests. Automated tests prove the certainty rules in code; they do not prove Safaricom sandbox connectivity or callback/query behaviour for the exact release.

Do not mark the payment gate PASS from unit/integration tests alone.

## Safety rules

- Use Daraja sandbox credentials only; never paste credentials, passkeys, access tokens or raw callback secrets into evidence notes.
- Run against the exact controlled-pilot release and record its 40-character release SHA.
- Use unique order/payment/payment-attempt/idempotency identities for each scenario unless the scenario explicitly tests idempotent replay.
- Never turn a timeout or transport error into a decline. The expected application state is `UNKNOWN` until provider query/reconciliation establishes terminal truth.
- M-PESA callbacks are evidence, not independently authenticated financial truth in this integration. A callback must not directly turn an attempt into `SUCCEEDED`; the status-query/reconciliation path establishes terminal truth.
- Do not clear payment rows or reconciliation jobs to make a failed exercise green.

## Evidence to retain per scenario

Retain non-secret evidence containing:

- exact release SHA and timestamp window;
- scenario ID;
- event/order/payment/payment-attempt IDs;
- provider ID (`mpesa`);
- application attempt state before and after each step;
- provider reference / CheckoutRequestID when issued;
- failure/detail codes, if any;
- whether reconciliation was required;
- final terminal state where one can be established;
- duplicate callback/request result where applicable;
- payment-provider health counts before and after the scenario.

Do **not** retain customer phone numbers in the shared evidence pack. Replace them with an opaque test-phone label if operator notes require correlation.

## Machine-verifiable field evidence

Record the eight scenarios in a non-secret JSON matrix and verify it on the exact release:

```bash
pnpm pilot:mpesa:verify -- \
  artifacts/pilot/mpesa-sandbox-input.json \
  artifacts/pilot/mpesa-sandbox-fault-matrix.json
```

The verifier is deliberately fail-closed. It requires all eight scenario IDs exactly once, a full 40-character release SHA, an event ID, `provider: "mpesa"`, `environment: "sandbox"`, and `liveMoneyApproved: false`. Every PASS scenario needs timestamps, an attempt ID, zero duplicate business effects and the scenario-specific observations described below.

The retained input/report must not contain fields named like phone/MSISDN, passkeys, secrets, tokens, authorization, credentials or passwords. The generated report includes a SHA-256 digest and still states `liveMoneyApproved: false`; it is evidence for the `paymentFaultMatrix` review, not permission to load production credentials.

A scenario that is `NOT_RUN`, `FAIL`, malformed, missing, duplicated, or inconsistent produces an overall `FAIL` report and a non-zero command exit.

## Required scenarios

### MPESA-01 — accepted STK push, successful payment

1. Create a fresh KES attempt for a whole-KES amount.
2. Confirm STK initiation returns a provider reference and application state becomes `PENDING`.
3. Complete the sandbox payment successfully.
4. Allow callback receipt and reconciliation/status query to run.
5. Confirm terminal `SUCCEEDED` is established without creating a second payment attempt.

PASS: one business payment attempt, one terminal success, no unresolved reconciliation job, no duplicate provider financial effect.

### MPESA-02 — customer cancellation / provider-declared failure

1. Create a fresh attempt.
2. Cancel/decline through the sandbox flow when supported.
3. Allow callback/query reconciliation to settle.

PASS: terminal `FAILED` is established from provider truth, never from a local timeout assumption; failure code is retained.

### MPESA-03 — initiation response uncertainty

Exercise a controlled network interruption/timeout around the STK initiation response while preserving the request identity.

PASS: application state becomes `UNKNOWN`, not `FAILED`; the attempt is scheduled/retained for reconciliation or manual review. Subsequent provider truth may move `UNKNOWN` to `PENDING`, `SUCCEEDED` or `FAILED` without creating a new business attempt.

### MPESA-04 — status-query timeout / transport failure

With an attempt that has a provider reference, interrupt the status query path.

PASS: the attempt remains `UNKNOWN` (or remains safely non-terminal) with reconciliation required. No false success or false decline is created.

### MPESA-05 — duplicate initiation request identity

Submit the exact same application initiation request again using the same idempotency key while the original is in flight or already persisted.

PASS: the duplicate request does not initiate a second provider transaction and does not create a second payment attempt.

### MPESA-06 — duplicate callback delivery

Replay the exact same callback payload/provider event identity through the callback endpoint.

PASS: the first callback is recorded once; the repeated delivery is classified as duplicate and has zero additional financial effect.

### MPESA-07 — callback arrives before/after reconciliation

Exercise callback and status-query ordering in both directions where practical.

PASS: ordering does not regress a terminal attempt, create a second success, or bypass the certainty rules. `SUCCEEDED`/`FAILED` remain terminal.

### MPESA-08 — malformed/incomplete callback

Replay a controlled malformed callback fixture with missing financial identity (for example a successful result without a valid amount) against a non-production test endpoint/environment.

PASS: callback is rejected/fails closed and does not establish financial truth.

## Adapter expectations already enforced by automated tests

The repository test suite must continue to prove that:

- unsupported currency and fractional-KES amounts are rejected before network access;
- STK timeout and transport failure return `UNKNOWN`;
- explicit provider rejection returns `FAILED`;
- query result `0` returns `SUCCEEDED`, explicit non-zero result returns `FAILED`, and accepted-but-not-final query returns `PENDING`;
- query timeout returns `UNKNOWN`;
- even a result-code-0 callback remains `UNKNOWN` until independent query/reconciliation establishes truth;
- malformed successful callbacks without a valid amount are rejected.

## Gate disposition

The payment-provider field gate can only be reviewed after all required applicable scenarios have retained evidence on the exact release. Automated green plus sandbox happy-path alone is insufficient.

Even a completed M-PESA matrix does not by itself approve live money; hardware/LAN/UPS, offline durability, Cloud/inventory convergence, abuse/flood, representative recovery, event close/reconciliation and named human review remain separate gates.
