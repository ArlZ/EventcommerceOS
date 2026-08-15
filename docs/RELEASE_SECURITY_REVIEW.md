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

### SEC-001 — P0 — Cloud payment caller authentication and authority separation

**Machine path status: remediated in `security/cloud-payment-machine-trust`, pending permanent CI and stack merge.**

The Event Edge machine credential now protects Cloud payment initiation, attempt reconciliation, payment-order reads and payment-rail availability. Cloud derives the Edge organisation from the server-side Edge registry and verifies event/payment tenant ownership before returning or mutating payment truth.

Provider callbacks remain on their separate provider-specific verification boundary and are not converted into Event Edge traffic.

Until real human authentication/RBAC exists, public Cloud routes for manual terminal confirmation, refunds, reversals, payment-adjustment history, manual-terminal evidence history and event payment health fail closed with `403`. The formerly anonymous Event Edge manual-terminal-confirmation route is removed as well. Underlying financial services remain intact for internal business-rule tests and future authenticated human controllers.

This closes the anonymous machine payment path without granting a machine credential human financial authority. It intentionally makes privileged payment operations unavailable through public HTTP until SEC-003 is remediated.

Security coverage includes unauthenticated initiation denial before durable payment creation, tenant-bound Edge initiation, cross-organisation order-read/reconciliation denial, authenticated rail-health access and fail-closed privileged human routes.

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
- HTTPS required outside loopback development by Event Edge Cloud transports;
- server-side Edge-to-organisation binding;
- request body `edgeId` must match the authenticated Edge;
- every synced commerce/inventory business `eventId` must belong to the Edge organisation;
- accepted sync/inventory events and device health state record authenticated Edge/organisation attribution;
- Edge credential versioning, rotation and revocation;
- append-only provision/rotate/revoke credential audit;
- version/status-guarded authentication rejects a credential rotated/revoked during verification;
- cross-organisation device-ID takeover rejected transactionally;
- device sequence replay protection scoped by organisation;
- the previously anonymous `/sync/devices` endpoint removed.

Security tests cover missing/wrong/unknown/revoked credentials, body identity mismatch, wrong-organisation event injection, rotation, authenticated attribution, cross-tenant device takeover and the inventory ingestion boundary.

### SEC-003 — P1 — Human administrative identity relies on caller-supplied headers

Administrative paths still use `x-actor-id`, `x-role` and `x-organisation-id` via the existing admin context. This is development/testing scaffolding, not production authentication. Privileged payment HTTP operations are now disabled rather than trusting this context, but configuration, command-centre, inventory-control and event-close administrative paths still require remediation.

**Required remediation:**

- validate server-issued short-lived human access tokens;
- derive actor identity and organisation/role membership from server-side state;
- remove direct trust in externally supplied role/organisation headers;
- step-up/supervisor permission for configured high-risk actions;
- explicit session/token expiry and revocation handling;
- re-enable privileged payment routes only through this authenticated human boundary.

### SEC-004 — P1 — POS device registration/revocation lifecycle

**Status: remediated in `security/pos-edge-trust`, pending permanent CI and stack merge.**

Implemented controls:

- stable POS `deviceId` explicitly provisioned at Event Edge;
- cryptographically random 256-bit per-device bearer credential with digest-only storage;
- credential uniqueness, versioning, rotation and revocation;
- server-side device assignment to an installed event plus optional sales location/register metadata;
- database foreign keys enforce installed event/location assignment;
- POS sync requires authenticated device ID, event assignment and assigned sales location for orders;
- POS-facing payment initiation/reconciliation/rail-health/order-history routes require an active device credential;
- payment initiation is bound to the device event assignment;
- new Edge payment-cache rows retain originating POS ownership, preventing another POS in the same event from reading/reconciling those payment attempts;
- legacy payment-cache rows retain event-level fallback to avoid stranding unresolved pre-upgrade attempts;
- append-only provision/rotate/reassign/revoke device audit plus `last_authenticated_at`;
- version/status-guarded authentication rejects a credential rotated/revoked during verification;
- Android stores endpoint/device ID as non-secret metadata but encrypts the bearer token using an AES-256 key held in Android Keystore;
- credential is injected only into HTTPS sync/payment request headers, never into Room/outbox payloads;
- Keystore/ciphertext loss forces explicit reprovisioning instead of silently reusing copied identity data;
- app supports credential replacement after rotation without deleting local commerce history.

**Offline-first caveat:** remote revocation cannot prevent a physically isolated stolen device from continuing local-only cash/order capture while it cannot reach Event Edge. Revocation blocks sync, electronic-payment access and POS-facing payment reads at the next Edge request. Lost-device handling therefore also requires physical recovery/quarantine and reconciliation procedures; the system will not introduce a Cloud lease that breaks offline sale durability.

### SEC-005 — P1 — Public endpoint abuse/rate limiting is not wired globally

No reviewed production-grade application/upstream abuse control is currently evidenced at the global HTTP boundary. Provider callbacks and payment initiation/reconciliation are especially sensitive to floods, expensive verification calls and database contention.

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

The permanent TypeScript and Android GitHub Actions jobs still fail before step 1 because GitHub does not allocate a runner. The latest stacked security PR again has both jobs with `steps: null`. No successful permanent gate exists for the current stack.

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

### Machine trust chain

The stacked security work authenticates POS -> Event Edge and Event Edge -> Cloud with independent revocable machine credentials. Event/organisation assignment is derived server-side at each boundary, while local POS ordering remains independent of Cloud availability. Event Edge -> Cloud payment machine calls now reuse the same revocable Edge identity and remain tenant-bound.

### Sync replay/conflict safety

Event Edge/Cloud persist processed event identities/sequences, detect replay/sequence reuse and raise explicit reconciliation exceptions for invalid/conflicting projections. Cloud replay protection is tenant-scoped for authenticated Edge traffic.

### Inventory/close audit safety

Inventory remains append-only ledger based; physical counts create traceable adjustments. Command-centre alert actions and event-close corrections are attributable/audited, and Task 009 serializes close/correction boundaries around immutable close revisions.

## Threat scenarios required before pilot

- unauthenticated Cloud payment initiation rejected;
- authenticated Edge denied another organisation's payment event/order/attempt;
- user token with wrong organisation rejected;
- bartender/operator denied refund/reversal/manual confirmation without permission;
- revoked Event Edge denied sync, inventory and machine payment access;
- forged/mismatched Edge ID denied;
- revoked POS denied Event Edge sync/payment access;
- wrong-event/location POS data rejected before durable Edge effect;
- peer POS in the same event denied another POS payment history/reconciliation;
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

SEC-001's anonymous machine-payment path, SEC-002 and SEC-004 are closed at code/review level in the stacked security branches, subject to permanent CI. Privileged human payment functionality remains deliberately fail-closed pending SEC-003.

Remaining mandatory release blockers are:

1. SEC-003 replacement of caller-trusted administrative role headers with real human authentication/RBAC and controlled re-enablement of privileged payment operations;
2. SEC-005 rate limiting/abuse controls;
3. SEC-006 tested backup/restore evidence;
4. SEC-007 green permanent CI on the exact release stack;
5. SEC-008 dependency/SCA evidence with no unaccepted critical/high risk.

After those are closed, the correct next status is **controlled live pilot candidate**, not major-festival ready. Graduation criteria remain in `docs/PILOT_RUNBOOK.md`.
