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

### SEC-001 — P0 — Cloud payment authentication/authorization

**Status: remediated in `security/operator-auth-rbac`, pending permanent CI and stack merge.**

Cloud payment routes are split by principal instead of treating one credential as universal authority.

Event Edge machine identity protects:

- payment initiation;
- payment-attempt reconciliation;
- provider-rail availability used by POS;
- order payment history/status used by POS.

Event-scoped machine calls verify the target event belongs to the authenticated Edge organisation.

Signed operator identity protects:

- manual external-terminal confirmation;
- refunds;
- reversals;
- payment adjustment/history reads;
- manual-terminal confirmation history;
- event payment health.

Authorization policy:

- `OPERATOR` has no sensitive payment authority by default;
- `SUPERVISOR` requires explicit event permission (`PAYMENT_MANUAL_CONFIRM`, `PAYMENT_REFUND`, `PAYMENT_VIEW`);
- `ADMIN` and `PLATFORM_ADMIN` remain tenant/platform scoped and may perform those actions without an explicit payment permission row;
- every refund requires two distinct authenticated authorized operators;
- reversals require `ADMIN` or `PLATFORM_ADMIN`;
- request-body actor/requestor/approver IDs cannot override signed identities.

Provider callbacks remain on provider-specific verification and do not inherit operator or Edge authority.

Event Edge forwards its machine credential for machine payment calls and forwards a human bearer token for manual terminal confirmation, so trusted machine identity never implies supervisor authority.

Adversarial tests cover anonymous/cross-tenant machine calls, supervisor permissions, actor spoofing, two-person refund approval, wrong-organisation approval, admin-only reversal and sensitive payment-view permissions.

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
- accepted sync/inventory events and device health state record authenticated Edge/organisation attribution;
- Edge credential versioning, rotation and revocation;
- append-only provision/rotate/revoke credential audit;
- version/status-guarded authentication rejects a credential that is rotated/revoked during verification;
- cross-organisation device-ID takeover rejected transactionally;
- device sequence replay protection scoped by organisation;
- the previously anonymous `/sync/devices` endpoint removed.

Security tests cover missing/wrong/unknown/revoked credentials, body identity mismatch, wrong-organisation event injection, rotation, authenticated attribution, cross-tenant device takeover and inventory ingestion.

### SEC-003 — P1 — Human operator authentication and RBAC

**Status: remediated in `security/operator-auth-rbac`, pending permanent CI and stack merge.**

Cloud now has explicit operator accounts with:

- UUID actor identity;
- server-side organisation membership;
- role (`OPERATOR`, `SUPERVISOR`, `ADMIN`, `PLATFORM_ADMIN`);
- high-entropy static credential stored only as SHA-256 digest;
- credential version and session version;
- active/revoked state;
- append-only lifecycle/permission audit.

`POST /auth/operator/session` exchanges the static credential for an Ed25519-signed access token. Tokens contain actor, organisation, role, credential/session versions, timestamps and token ID. Default lifetime is 15 minutes and may be configured up to 12 hours for bounded event-shift/offline use.

Cloud rechecks the current account on every protected request, so credential rotation, session revocation and account revocation take effect immediately for connected Cloud actions.

Configuration, Command Centre and event-close routes are protected by a global signed-operator boundary. The legacy internal `AdminContext` is preserved for service compatibility, but `x-actor-id`, `x-role` and `x-organisation-id` are overwritten only after cryptographic authentication. Externally supplied role/organisation headers have no authority.

Cloud inventory operational reads are also signed-operator protected and tenant/event scoped.

Event Edge verifies the same operator tokens offline using only the Ed25519 public key. It additionally checks the token organisation against `EDGE_ORGANISATION_ID`. Mutation actor IDs must match the signed subject, after which existing local `edge_inventory_actor_permissions` remain authoritative for inventory move/transfer/count/alert/configuration permissions.

Event Edge administrative triggers are role restricted:

- inventory configuration install: `ADMIN` or `PLATFORM_ADMIN`;
- alert evaluation/escalation: `SUPERVISOR` or higher;
- notification drain: `ADMIN` or higher.

**Offline revocation caveat:** Event Edge deliberately does not introspect Cloud on each operator action. A valid Edge-side operator token therefore remains usable until its expiry whether or not WAN is currently available. This is intentional: immediate central revocation and WAN-independent local operations cannot both be guaranteed without an online introspection dependency. Cloud-side actions still revoke immediately because Cloud rechecks current account state on every request.

Adversarial tests cover trusted-header spoofing, role escalation, wrong credential, tampered token, session/credential invalidation, cross-organisation access, offline Edge signature verification, actor spoofing and local-permission denial.

### SEC-004 — P1 — POS device registration/revocation lifecycle

**Status: remediated in `security/pos-edge-trust`, pending permanent CI and stack merge.**

Implemented controls:

- stable POS `deviceId` provisioned explicitly at Event Edge;
- cryptographically random 256-bit per-device bearer credential with digest-only storage;
- credential uniqueness, versioning, rotation and revocation;
- server-side device assignment to an installed event plus optional sales location/register metadata;
- database foreign keys enforce installed event/location assignment;
- POS sync requires authenticated device ID, event assignment and assigned sales location for orders;
- POS-facing payment initiation/reconciliation/rail-health/order-history routes require an active device credential;
- payment initiation is bound to the device event assignment;
- new Edge payment-cache rows retain originating POS ownership, preventing another POS in the same event from reading/reconciling those attempts;
- legacy payment-cache rows retain event-level fallback to avoid stranding unresolved pre-upgrade attempts;
- append-only provision/rotate/reassign/revoke device audit plus `last_authenticated_at`;
- version/status-guarded authentication rejects a credential that is rotated/revoked during verification;
- Android stores endpoint/device ID as non-secret metadata but encrypts the bearer token using an AES-256 key held in Android Keystore;
- credential is injected only into HTTPS sync/payment request headers, never into Room/outbox payloads;
- Keystore/ciphertext loss forces explicit reprovisioning instead of silently reusing copied identity data;
- app supports credential replacement after rotation without deleting local commerce history.

Security tests cover missing/wrong/revoked/rotated credentials, device/body mismatch, wrong event, wrong sales location, reassignment, payment ownership isolation and no-business-effect rejection paths. Existing replay/offline/concurrency sync suites now run through authenticated device identities.

**Offline-first caveat:** remote revocation cannot prevent a physically isolated stolen device from continuing local-only cash/order capture while it cannot reach Event Edge. Revocation blocks sync, electronic-payment access and POS-facing payment reads at the next Edge request. Lost-device handling therefore also requires physical recovery/quarantine and reconciliation procedures; the system will not introduce a Cloud lease that breaks offline sale durability.

### SEC-005 — P1 — Public endpoint abuse/rate limiting is not wired globally

No reviewed application-level rate/abuse control is currently installed at the global HTTP boundary. Provider callbacks, session creation and payment initiation/reconciliation are especially sensitive to floods, expensive verification calls and database contention.

**Required remediation:**

- rate limits by endpoint/caller/provider contract;
- payload/body size limits;
- connection/request timeouts;
- provider callback limits that preserve legitimate retry bursts;
- session/login brute-force controls;
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

### End-to-end trust chain

The stacked security work now separates and authenticates:

- POS -> Event Edge device identity;
- Event Edge -> Cloud machine identity;
- human operator identity/RBAC.

Event/organisation assignment is derived server-side at machine boundaries. Human actor/role/organisation is derived from signed tokens/server-side account state. Local POS ordering and authorized Event Edge inventory operations do not synchronously depend on Cloud availability.

### Sync replay/conflict safety

Event Edge/Cloud persist processed event identities/sequences, detect replay/sequence reuse and raise explicit reconciliation exceptions for invalid/conflicting projections. Cloud replay protection is tenant-scoped for authenticated Edge traffic.

### Inventory/close audit safety

Inventory remains append-only ledger based; physical counts create traceable adjustments. Privileged inventory mutations use signed actor identity plus local permission checks. Command-centre alert actions and event-close corrections use signed admin identity and are auditable. Task 009 serializes close/correction boundaries around immutable close revisions.

## Threat scenarios required before pilot

- unauthenticated Cloud payment initiation rejected;
- authenticated Edge denied another organisation event/payment;
- signed user token with wrong organisation rejected;
- caller-supplied role/actor/organisation headers cannot elevate access;
- OPERATOR denied refund/reversal/manual confirmation without permission;
- refund requires two distinct authenticated authorized operators;
- revoked/rotated Cloud operator token rejected immediately by Cloud;
- forged/expired/wrong-organisation operator token rejected by Event Edge;
- Event Edge mutation actor spoof rejected before durable effect;
- signed Edge operator without local inventory permission denied;
- authorized Edge inventory operation still works while WAN transport is unavailable;
- revoked Event Edge denied both sync and inventory ingestion;
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

SEC-001, SEC-002, SEC-003 and SEC-004 are closed at code/review level in the stacked security branches, subject to permanent CI and stack merge. Remaining mandatory release blockers are:

1. SEC-005 rate limiting/abuse/body-size controls;
2. SEC-006 tested backup/restore evidence;
3. SEC-007 green permanent CI on the exact release stack;
4. SEC-008 dependency/SCA evidence with no unaccepted critical/high risk.

After those are closed, the correct next status is **controlled live pilot candidate**, not major-festival ready. Graduation criteria remain in `docs/PILOT_RUNBOOK.md`.
