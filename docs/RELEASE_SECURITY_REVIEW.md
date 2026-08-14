# Event Commerce OS — Task 010 Release Security Review

Review scope: payments, provider callbacks, authentication/RBAC, device/Edge trust, synchronization, privileged inventory/close actions, secrets/card-data boundary and operational recovery.

Status: **NOT CLEARED FOR INTERNET-EXPOSED PRODUCTION OR A LIVE-MONEY PILOT**

This review distinguishes implemented domain safety from missing deployment/security controls. A strong payment state machine does not make an unauthenticated HTTP endpoint safe.

## Severity convention

- **P0** — immediate catastrophic/exploit risk; do not expose/deploy.
- **P1** — release blocker for pilot/live money.
- **P2** — must be remediated or explicitly accepted with bounded pilot controls.
- **P3** — hardening/operational improvement.

## Findings

### SEC-001 — P0 — Cloud payment mutation endpoints do not have production authentication

Observed controller surface includes:

- `POST /payments/initiate`;
- `POST /payments/manual-terminal-confirmations`;
- `POST /payments/refunds`;
- `POST /payments/reversals`;
- `POST /payments/attempts/:id/reconcile`;
- payment history/order/health reads.

`apps/cloud-api/src/payments/payments.controller.ts` does not apply an authenticated operator/device guard, and `apps/cloud-api/src/main.ts` does not install a global authentication guard.

Some downstream services validate actor/permission data, but without cryptographically established caller identity an external caller can potentially supply/spoof business identity fields.

**Required remediation before exposure/live money:**

- real access-token validation at the Cloud boundary;
- separate machine identity for Event Edge/device-originated calls;
- server-derived actor/device/organisation context rather than trusting request-body identity;
- route-level scopes/roles for initiation, refund, reversal, manual confirmation, reconciliation and sensitive reads;
- tests proving unauthenticated/incorrect-scope calls are denied.

Do not substitute another trusted header for authentication.

### SEC-002 — P0 — Cloud sync ingestion/device-health endpoints are unauthenticated

`apps/cloud-api/src/sync/cloud-sync.controller.ts` exposes:

- `POST /sync/edge-events`;
- `GET /sync/devices`.

No controller/global authentication mechanism establishes that the caller is a registered, non-revoked Event Edge instance.

The sync service has meaningful replay/conflict controls, but idempotency is not authentication. An attacker must not be allowed to submit syntactically valid event envelopes.

**Required remediation:**

- Edge registration and revocation model;
- per-Edge credential/certificate or signed short-lived machine token;
- organisation/event binding enforced server-side;
- credential rotation/revocation procedure;
- replay-resistant authenticated request envelope where appropriate;
- tests for unregistered/revoked/wrong-organisation Edge rejection.

### SEC-003 — P1 — Administrative identity currently relies on caller-supplied headers

Administrative paths use `x-actor-id`, `x-role` and `x-organisation-id` via `adminContextFromHeaders`.

This is useful scaffolding for internal development/testing, but it is not a production authentication system. Any caller able to reach those routes can assert `ADMIN`/`PLATFORM_ADMIN` unless an upstream trusted identity layer is guaranteed and enforced.

**Required remediation:**

- validate signed short-lived user access tokens;
- derive actor/role/organisation membership from trusted claims/server-side membership;
- remove direct trust in externally supplied role headers;
- step-up/supervisor approval for configured high-risk actions;
- explicit session/token revocation and expiry handling.

### SEC-004 — P1 — Device registration/revocation trust boundary is not implemented end-to-end

The reliability baseline requires device registration and revocation, but the current repository does not establish a production-grade device identity lifecycle across POS -> Edge -> Cloud.

**Required remediation:**

- unique device identity generated/provisioned through a controlled flow;
- event/register assignment bound to that identity;
- revocation and re-provisioning;
- stolen/reused credential handling;
- last-seen/version/security posture visibility;
- audit trail for assignment/reassignment/revocation.

### SEC-005 — P1 — Public endpoint abuse/rate limiting is not wired globally

`main.ts` configures CORS but no application-level rate limiting/abuse control is visible at the global HTTP boundary.

Provider callbacks and initiation/reconciliation endpoints are especially sensitive to request floods, expensive verification calls and database contention.

**Required remediation:**

- rate limits by endpoint/caller/provider contract;
- payload/body size limits;
- connection/request timeouts;
- provider callback-specific limits that do not break legitimate retry bursts;
- alerting for sustained rejects/abuse;
- upstream WAF/reverse-proxy controls documented as part of deployment.

### SEC-006 — P1 — Backup/restore procedure is specified but not yet evidenced

The security/reliability baseline requires database backup and tested restore. The repository/runbook now defines the exercise, but Task 010 has no executed restore evidence.

**Required remediation/evidence:**

- real Cloud DB backup;
- isolated restore;
- representative order/payment/inventory/audit/close verification;
- RPO/RTO measurement;
- operator/time/evidence retained.

### SEC-007 — P1 — Permanent CI/security checks are currently externally blocked

The permanent TypeScript and Android GitHub Actions jobs are still failing before step 1 because GitHub does not allocate a runner. No successful permanent gate exists for the current stack.

The local execution environment also cannot currently fetch the pinned pnpm toolchain from the npm registry, so dependency audit/build cannot substitute for CI here.

**Required before merge/pilot:** permanent CI must execute and pass on the exact release commit.

### SEC-008 — P2 — Dependency vulnerability evidence is incomplete

Task 010 attempted the checks available in the environment. Node/TypeScript are present, but pnpm installation/toolchain resolution requires registry access that is unavailable in this execution environment. GitHub Actions is also blocked before steps execute.

**Required release evidence:**

- locked dependency install from `pnpm-lock.yaml`;
- package-manager audit or approved SCA equivalent;
- Android/Gradle dependency scan where available;
- review of high/critical findings with explicit disposition;
- secret scanning on the release branch/repository.

No claim is made that the current dependency graph is vulnerability-free.

## Positive controls already present

### Payment state/idempotency safety

Implemented payment architecture has strong business-safety foundations:

- explicit attempt states including durable `UNKNOWN`;
- duplicate initiation/idempotency protections;
- immutable attempt history;
- late provider truth can resolve uncertainty;
- duplicate callbacks are deduplicated;
- refund/reversal intent is separate durable history;
- one provider retry cannot silently overwrite earlier truth.

These controls reduce duplicate-charge/accounting risk but do not replace endpoint authentication.

### Provider boundary/card-data minimization

The documented implementation keeps provider-specific logic at the Cloud adapter boundary and rejects prohibited raw card data fields at payment HTTP boundaries. Pesapal Sabi card credentials remain in the certified terminal/provider domain.

No claim is made that the deployment is automatically PCI DSS compliant or out of PCI scope.

### Callback verification/reconciliation

The provider integrations use provider-specific validation/verification rules rather than treating an arbitrary callback body as final truth. Mismatched identifiers/amount/currency and uncertain provider states remain explicit reconciliation cases.

### Sync replay/conflict safety

Cloud sync persists processed event identities/sequences, detects event-instance/device-sequence reuse and raises explicit reconciliation exceptions for invalid/conflicting order projections. Money/inventory truth is not last-write-wins.

### Inventory/close audit safety

Inventory is append-only ledger based; physical counts create traceable adjustments. Command-centre alert actions and event-close corrections are attributable/audited. Task 009 also serializes close/correction boundaries so operator corrections cannot race across an immutable close revision.

## Threat scenarios that must be demonstrated before pilot

- unauthenticated payment initiation rejected;
- user token with wrong organisation rejected;
- bartender/operator denied refund/reversal/manual confirmation when lacking permission;
- revoked device/Edge denied sync;
- forged device ID cannot impersonate another register;
- duplicate/reordered signed sync cannot duplicate a business effect;
- forged/incorrect provider callback rejected;
- valid duplicate provider callback has one business effect;
- provider timeout yields `UNKNOWN`, not failure;
- delayed authoritative success resolves original attempt without a second charge;
- request flood/rate-limit exercise does not starve local event operations;
- privileged inventory/close actions create immutable audit evidence;
- audit/ledger records cannot be mutated/deleted through application APIs;
- secrets/card data absent from logs/database/sample exports.

## Release disposition

**Current disposition: NO-GO for internet-exposed production/live-money pilot.**

The system may continue through engineering simulation and internal/sandbox exercises, but the following are mandatory release blockers:

1. SEC-001 payment API authentication/authorization;
2. SEC-002 Edge sync authentication/registration;
3. SEC-003 replacement of caller-trusted admin role headers;
4. SEC-004 device identity/revocation lifecycle;
5. SEC-005 rate limiting/abuse controls;
6. SEC-006 tested backup/restore evidence;
7. SEC-007 green permanent CI on the exact release stack;
8. SEC-008 dependency/SCA evidence with no unaccepted critical/high risk.

After those are closed, the correct next status is **controlled live pilot candidate**, not major-festival ready. Graduation criteria remain in `docs/PILOT_RUNBOOK.md`.
