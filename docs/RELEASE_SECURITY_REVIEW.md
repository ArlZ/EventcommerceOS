# Event Commerce OS — Task 010 Release Security Review

Review scope: payments, provider callbacks, authentication/RBAC, device/Edge trust, synchronization, privileged inventory/close actions, secrets/card-data boundary and operational recovery.

Status: **NOT CLEARED FOR INTERNET-EXPOSED PRODUCTION OR A LIVE-MONEY PILOT**

This review distinguishes implemented domain safety from deployment/security controls. A strong payment state machine does not make an unauthenticated HTTP endpoint safe.

## Severity convention

- **P0** — immediate catastrophic/exploit risk; do not expose/deploy.
- **P1** — release blocker for pilot/live money.
- **P2** — must be remediated or explicitly accepted with bounded pilot controls.
- **P3** — hardening/operational improvement.

## Findings

### SEC-001 — P0 — Cloud payment mutation/read endpoints still lack production authentication

Observed controller surface includes payment initiation, manual terminal confirmation, refunds, reversals, reconciliation and sensitive payment history/health reads.

`apps/cloud-api/src/payments/payments.controller.ts` does not yet apply a cryptographically authenticated operator/device guard, and no global user authentication guard establishes caller identity. Some downstream services validate actor/permission data, but those checks cannot substitute for trustworthy caller provenance.

**Required remediation before exposure/live money:**

- signed short-lived access-token validation at the Cloud boundary;
- server-derived actor/device/organisation context;
- route scopes/roles for initiation, refund, reversal, manual confirmation, reconciliation and sensitive reads;
- tests proving unauthenticated and incorrectly scoped calls are denied.

Do not substitute another caller-trusted header for authentication.

### SEC-002 — P0 — Event Edge to Cloud machine ingress

**Status: remediated in `security/edge-cloud-trust`, pending permanent CI and stack merge.**

The remediation closes both Edge-originated Cloud ingestion paths:

- `POST /sync/edge-events`;
- `POST /inventory/edge-events`.

Implemented controls:

- per-Edge machine identity and cryptographically random 256-bit bearer credential;
- Cloud stores only SHA-256 credential digests;
- constant-time credential comparison;
- unique credential digest per Edge identity;
- stable `EDGE_ID` plus runtime-only `EDGE_CLOUD_SYNC_TOKEN` on Event Edge;
- HTTPS required outside loopback development by both Event Edge Cloud transports;
- server-side Edge-to-organisation binding;
- request body `edgeId` must match the authenticated Edge;
- every synced commerce/inventory business `eventId` must belong to the Edge organisation;
- accepted sync events and device health state record authenticated Edge/organisation attribution;
- Edge credential versioning, rotation and revocation;
- append-only provision/rotate/revoke credential audit;
- immediate rejection of revoked/old rotated credentials;
- cross-organisation device-ID takeover rejected transactionally;
- device sequence replay protection scoped by organisation;
- the previously anonymous `/sync/devices` endpoint removed.

Security tests cover missing/wrong/unknown/revoked credentials, body identity mismatch, wrong-organisation event injection, rotation, authenticated attribution, cross-tenant device takeover and the inventory ingestion boundary.

**Important remaining boundary:** this does not authenticate POS devices to Event Edge. A registered Edge remains the trusted machine boundary for the device events it relays until SEC-004 is implemented.

### SEC-003 — P1 — Administrative identity relies on caller-supplied headers

Administrative paths use `x-actor-id`, `x-role` and `x-organisation-id` via the existing admin context. This remains development/testing scaffolding, not production authentication.

**Required remediation:**

- validate signed short-lived user access tokens;
- derive actor/role/organisation membership from trusted claims/server-side membership;
- remove direct trust in externally supplied role headers;
- step-up/supervisor approval for configured high-risk actions;
- explicit session/token revocation and expiry handling.

### SEC-004 — P1 — POS device registration/revocation is not implemented end-to-end

The new Edge machine identity does not establish a production-grade POS device identity lifecycle for POS -> Event Edge.

**Required remediation:**

- unique device identity provisioned through a controlled flow;
- event/register assignment bound to that identity;
- device-to-Edge authenticated requests;
- revocation and re-provisioning;
- stolen/reused credential handling;
- last-seen/version/security posture visibility;
- audit trail for assignment/reassignment/revocation.

### SEC-005 — P1 — Public endpoint abuse/rate limiting is not wired globally

No reviewed application-level rate/abuse control is currently installed at the global HTTP boundary. Provider callbacks and payment initiation/reconciliation are especially sensitive to floods, expensive verification calls and database contention.

**Required remediation:**

- rate limits by endpoint/caller/provider contract;
- payload/body size limits;
- connection/request timeouts;
- provider callback limits that preserve legitimate retry bursts;
- sustained-reject/abuse alerting;
- documented upstream WAF/reverse-proxy controls.

### SEC-006 — P1 — Backup/restore procedure is specified but not evidenced

Task 010 defines the exercise but has no executed restore evidence.

**Required evidence:** real Cloud backup, isolated restore, representative order/payment/inventory/audit/close verification, measured RPO/RTO and retained operator evidence.

### SEC-007 — P1 — Permanent CI/security checks are externally blocked

The permanent TypeScript and Android GitHub Actions jobs still fail before step 1 because GitHub does not allocate a runner. No successful permanent gate exists for the current stack.

**Required before merge/pilot:** permanent CI must execute and pass on the exact release commit.

### SEC-008 — P2 — Dependency vulnerability evidence is incomplete

A locked install/package-manager audit or approved SCA equivalent plus Android dependency/security review remains required. No claim is made that the current dependency graph is vulnerability-free.

## Positive controls already present

### Payment state/idempotency safety

- explicit payment states including durable `UNKNOWN`;
- duplicate initiation/idempotency protection;
- immutable attempt history;
- late provider truth can resolve uncertainty;
- callback deduplication;
- separate durable refund/reversal history;
- provider retries cannot silently overwrite earlier truth.

### Provider boundary/card-data minimization

Provider-specific logic remains at the Cloud adapter boundary. Payment command endpoints reject prohibited raw card credential fields; Pesapal Sabi card credentials remain within the certified terminal/provider domain. This is not itself a PCI DSS compliance determination.

### Callback verification/reconciliation

Provider integrations use provider-specific validation/verification rather than accepting arbitrary callback bodies as final truth. Identifier/amount/currency conflicts remain explicit reconciliation cases.

### Edge Cloud machine trust

The stacked Edge trust remediation authenticates both order/sync and inventory Edge ingestion, binds the Edge to an organisation server-side and adds rotation/revocation/audit without coupling local sales to Cloud availability.

### Sync replay/conflict safety

Cloud persists processed event identities/sequences, detects event-instance/device-sequence reuse and raises explicit reconciliation exceptions for invalid/conflicting order projections. Replay protection is now tenant-scoped for authenticated Edge traffic.

### Inventory/close audit safety

Inventory remains append-only ledger based; physical counts create traceable adjustments. Command-centre alert actions and event-close corrections are attributable/audited, and Task 009 serializes close/correction boundaries around immutable close revisions.

## Threat scenarios required before pilot

- unauthenticated payment initiation rejected;
- user token with wrong organisation rejected;
- bartender/operator denied refund/reversal/manual confirmation without permission;
- revoked Event Edge denied both sync and inventory ingestion;
- forged/mismatched Edge ID denied;
- authenticated Edge denied another organisation event;
- revoked POS device denied Event Edge access once SEC-004 is implemented;
- duplicate/reordered authenticated sync cannot duplicate a business effect;
- forged/incorrect provider callback rejected;
- valid duplicate provider callback has one business effect;
- provider timeout yields `UNKNOWN`, not failure;
- delayed authoritative success resolves the original attempt without a second charge;
- request-flood/rate-limit exercise does not starve local event operations;
- privileged inventory/close actions create immutable audit evidence;
- audit/ledger records cannot be mutated/deleted through application APIs;
- secrets/card data absent from logs/database/sample exports.

## Release disposition

**Current disposition: NO-GO for internet-exposed production/live-money pilot.**

SEC-002 is closed at code/review level in the Edge Cloud trust stack, subject to permanent CI. Remaining mandatory release blockers are:

1. SEC-001 payment API authentication/authorization;
2. SEC-003 replacement of caller-trusted administrative role headers;
3. SEC-004 POS device identity/revocation lifecycle;
4. SEC-005 rate limiting/abuse controls;
5. SEC-006 tested backup/restore evidence;
6. SEC-007 green permanent CI on the exact release stack;
7. SEC-008 dependency/SCA evidence with no unaccepted critical/high risk.

After those are closed, the correct next status is **controlled live pilot candidate**, not major-festival ready. Graduation criteria remain in `docs/PILOT_RUNBOOK.md`.
