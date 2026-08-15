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

**Status: remediated across `security/cloud-payment-machine-trust` and `security/human-auth-rbac`, pending permanent CI and stack merge.**

The Event Edge machine credential protects Cloud payment initiation, attempt reconciliation, payment-order reads and payment-rail availability. Cloud derives the Edge organisation from the server-side Edge registry and verifies event/payment tenant ownership before returning or mutating payment truth.

Provider callbacks remain on their separate provider-specific verification boundary and are not converted into Event Edge traffic.

Privileged human payment operations are re-enabled only through revocable operator sessions and server-derived organisation roles:

- manual terminal confirmation: `ADMIN` or `SUPERVISOR`, plus the existing event-specific `PAYMENT_MANUAL_CONFIRM` permission;
- refund/reversal mutations: `FINANCE` only for organisation-scoped operators; `PLATFORM_ADMIN` retains platform override authority;
- financial history reads: `ADMIN` or `FINANCE`;
- manual-terminal evidence history: `ADMIN`, `FINANCE` or `SUPERVISOR`;
- event payment health: authenticated organisation roles including read-only `VIEWER`.

Request-body actor identity must match the authenticated operator. Public HTTP does not accept a caller-supplied `approvingActorId`; a separate approval session/step-up flow is required before any operation that needs a second approver can be exposed.

Machine credentials cannot satisfy the human authorization boundary, and human operator sessions cannot replace provider callback verification.

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

### SEC-003 — P1 — Human administrative identity and RBAC

**Status: remediated in `security/human-auth-rbac`, pending permanent CI and stack merge.**

Cloud now uses revocable, expiring opaque operator sessions. Session secrets are generated with 256 bits of randomness and only SHA-256 digests are stored. Actor identity, platform authority and organisation membership/role are resolved from Cloud database state on each request.

Implemented controls:

- operator identities can be active or revoked;
- organisation memberships are server-side and role-scoped: `ADMIN`, `FINANCE`, `SUPERVISOR`, `VIEWER`;
- `PLATFORM_ADMIN` is separate platform-wide authority;
- sessions expire and can be individually revoked; identity revocation invalidates active sessions/memberships;
- caller-supplied `x-actor-id` and `x-role` are stripped globally before controllers execute;
- `x-organisation-id` is only a requested scope selector and is checked against server-side membership;
- organisation creation is platform-admin-only;
- configuration remains `ADMIN`/`PLATFORM_ADMIN`;
- command-centre and event-close distinguish read, operational-action, financial-correction and close/reopen roles;
- refund/reversal mutation authority is separated from general event administration and requires `FINANCE` for organisation-scoped operators;
- privileged payment actor IDs must match the authenticated session;
- operator/session/membership lifecycle actions have append-only audit records;
- control-web stores the temporary access token in browser `sessionStorage`, injects it only for the configured Cloud origin and strips obsolete actor/role headers.

The controlled-pilot provisioning path is an audited Cloud DB-admin CLI, not a password login flow. No claim is made that this is final enterprise IAM: external OIDC/SSO, MFA and organization-specific identity-policy integration remain appropriate P2 hardening/graduation work beyond a bounded pilot.

Adversarial coverage includes legacy-header privilege spoofing, role inflation, wrong-organisation selection, platform-only organisation creation, expired/revoked session rejection, revoked-identity rejection, machine-token rejection on human routes, role separation, organisation-admin denial for refund/reversal mutation and privileged payment actor spoof rejection before business effect.

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

### SEC-005 — P1 — HTTP abuse and resource-exhaustion controls

**Status: remediated at application/code level in `security/abuse-controls`, pending permanent CI, stack merge and deployment evidence.**

Implemented Cloud controls:

- global token-bucket policies for Edge sync/inventory, Edge payment, provider callbacks, operator reads, operator mutations and public/invalid traffic;
- dual source-IP and caller-fingerprint limits where a stable caller exists;
- bearer/session credentials are SHA-256 fingerprinted before bucket use and are never logged as raw keys;
- abuse throttling executes before operator/session database authentication, preventing random fake operator tokens from turning authentication itself into a database-amplification path;
- hard-bounded in-memory bucket cardinality with least-recently-used eviction;
- sampled structured `HTTP_ABUSE_RATE_REJECT` warnings instead of one log entry per rejected packet;
- `429`, `Retry-After` and rate-limit response metadata;
- explicit JSON/urlencoded body-size bounds;
- inbound header/request/keep-alive timeout bounds and maximum parsed header count;
- Edge sync/inventory request validators still cap batches at 100 business events.

Implemented Event Edge controls:

- independent local token buckets for POS sync, POS payment and other LAN HTTP traffic;
- device/source fingerprinting without storing raw device bearer credentials;
- bounded bucket cardinality and sampled `EDGE_HTTP_ABUSE_RATE_REJECT` warnings;
- independent body/header/request/keep-alive limits;
- no Cloud/shared limiter dependency, preserving offline-first local commerce.

The rate values are intentionally higher for Edge replay/payment and provider callback traffic than generic public traffic so recovery/retry bursts are bounded without being treated like human/public abuse.

Per-process memory buckets are not represented as globally distributed protection. Production must explicitly select `ABUSE_DEPLOYMENT_MODE`:

- `single_instance_pilot` for a tightly controlled single-Cloud-instance pilot;
- `upstream_distributed` for multi-instance internet production, which additionally requires an explicitly confirmed upstream WAF/API gateway/reverse-proxy layer and a configured trusted proxy hop count.

`docs/ABUSE_PROTECTION.md` defines the upstream contract, proxy-trust rules, default/tunable limits and the mandatory pilot flood exercise. The deployment evidence pack must prove the real upstream configuration when distributed mode is used; setting the confirmation environment variable is not itself evidence.

Payment semantics remain unchanged under throttling: a `429`/timeout is transport uncertainty, never invented provider failure, and delayed callbacks still reconcile through authoritative provider status.

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

### Authenticated trust chain

The stacked security work authenticates POS -> Event Edge and Event Edge -> Cloud with independent revocable machine credentials, and authenticates human Cloud operations with a separate revocable session boundary. Event/organisation assignment is derived server-side. Local POS ordering remains independent of Cloud availability, and no machine credential is promoted into human financial authority.

### Sync replay/conflict safety

Event Edge/Cloud persist processed event identities/sequences, detect replay/sequence reuse and raise explicit reconciliation exceptions for invalid/conflicting projections. Cloud replay protection is tenant-scoped for authenticated Edge traffic.

### Inventory/close audit safety

Inventory remains append-only ledger based; physical counts create traceable adjustments. Command-centre alert actions and event-close corrections are attributable/audited, and Task 009 serializes close/correction boundaries around immutable close revisions.

## Threat scenarios required before pilot

- unauthenticated Cloud payment initiation rejected;
- authenticated Edge denied another organisation's payment event/order/attempt;
- operator session with wrong organisation rejected;
- caller-supplied actor/role headers cannot inflate authority;
- expired/revoked human session rejected;
- revoked human identity rejected;
- `ADMIN` denied refund/reversal mutation unless operating as platform administrator;
- `VIEWER`/`SUPERVISOR`/`FINANCE` denied actions outside their explicit role;
- privileged payment body cannot name a different requesting actor;
- machine Edge credential cannot satisfy a human administrative route;
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
- public/fake-session request flood is rate-limited before operator-auth database work;
- Event Edge throttles a runaway test POS while another registered POS remains usable;
- request-flood/rate-limit exercise does not starve local event operations;
- privileged inventory/close actions create immutable audit evidence;
- audit/ledger records cannot be mutated/deleted through application APIs;
- secrets/card data absent from logs/database/sample exports.

## Release disposition

**Current disposition: NO-GO for internet-exposed production/live-money pilot.**

SEC-001 through SEC-005 are closed at code/review level in the stacked security branches, subject to permanent CI and merge. SEC-005 additionally requires deployment-mode/flood-exercise evidence on the real pilot topology; multi-instance production requires the documented upstream distributed boundary.

Remaining mandatory release blockers are:

1. SEC-006 tested backup/restore evidence;
2. SEC-007 green permanent CI on the exact release stack;
3. SEC-008 dependency/SCA evidence with no unaccepted critical/high risk;
4. SEC-005 real deployment abuse-test evidence before live exposure.

External OIDC/SSO/MFA is still recommended before graduating beyond a tightly controlled pilot, but the repository no longer trusts browser-supplied role/actor headers for operational authority.

After those mandatory blockers are closed, the correct next status is **controlled live pilot candidate**, not major-festival ready. Graduation criteria remain in `docs/PILOT_RUNBOOK.md`.
