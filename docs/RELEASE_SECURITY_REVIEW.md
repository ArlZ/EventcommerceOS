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

**Status: remediated and merged into `main`; exact-release operational acceptance remains required.**

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

**Status: remediated and merged into `main`; exact-release operational acceptance remains required.**

The remediation closes both Edge-originated machine routes:

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

**Status: remediated and merged into `main`; exact-release operational acceptance remains required.**

Cloud now uses password + email-code browser sign-in backed by Supabase Auth, followed by a separate revocable, expiring Event Commerce OS operator session. After the password proof succeeds, Event Control requires a six-digit email OTP; Cloud issues its own opaque operator session only after that verification succeeds. Operator session secrets use 256 bits of randomness and only SHA-256 digests are stored. Actor identity, platform authority and organisation membership/role are resolved from Cloud database state on each request.

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
- control-web sends authentication requests with credentials enabled; Cloud stores the login challenge and authenticated operator session in HttpOnly, `SameSite=Strict` cookies that are `Secure` in production;
- the browser does not receive or persist the upstream Supabase access token; the temporary upstream proof is signed out after verification on a best-effort basis;
- the legacy/admin-issued `ecom_op_...` bearer session remains a bounded provisioning/recovery/diagnostic path rather than the normal browser sign-in mechanism.

Controlled-pilot identity and membership provisioning remains an audited Cloud DB-admin action, while normal browser access now uses the provisioned operator work email, password and six-digit email verification code. Password recovery remains administrator-managed. No claim is made that this is final enterprise IAM: external OIDC/SAML SSO, authenticator-based MFA/step-up and organization-specific identity-policy integration remain appropriate P2 hardening/graduation work beyond a bounded pilot.

Adversarial coverage includes legacy-header privilege spoofing, role inflation, wrong-organisation selection, platform-only organisation creation, expired/revoked session rejection, revoked-identity rejection, machine-token rejection on human routes, role separation, organisation-admin denial for refund/reversal mutation and privileged payment actor spoof rejection before business effect.

### SEC-004 — P1 — POS device registration/revocation lifecycle

**Status: remediated and merged into `main`; exact-release operational acceptance remains required.**

Implemented controls:

- stable POS `deviceId` explicitly provisioned at Event Edge;
- cryptographically random 256-bit per-device bearer credential with digest-only storage;
- credential uniqueness, versioning, rotation and revocation;
- server-side device assignment to an installed event plus optional sales-location/register metadata;
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

**Status: remediated at application/code level and merged into `main`; real deployment/flood evidence remains required.**

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

### SEC-006 — P1 — Backup/restore evidence

**Status: executable with a permanent synthetic regression smoke merged into `main`; not closed until a representative release-candidate restore drill passes and is signed off.**

The repository now includes a destructive-safety-aware PostgreSQL drill that exports a consistent source snapshot, fingerprints every public table, creates/validates a custom-format dump, restores into a separately verified target database, compares table lists/counts/content fingerprints, checks restored sequence safety and records RPO/RTO evidence.

The drill defaults to requiring representative organisation/event, synced commerce, payment, inventory, audit, event-close and machine/human identity data. Live/production data additionally requires explicit encrypted-storage acknowledgement before dump creation.

This is an evidence mechanism, not evidence itself. SEC-006 remains a release blocker until `docs/BACKUP_RESTORE.md` has been followed against the exact release candidate and the retained PASS manifest is reviewed by a named operator/reviewer.

### SEC-007 — P1 — Permanent CI/security gate execution

**Status: runner-allocation blocker closed; permanent TypeScript/Android/SCA CI has executed green on the fully merged application/security stack. Exact-release enforcement still requires protected-branch policy.**

The permanent workflow exercises the repository TypeScript build/lint/typecheck/test/format/architecture checks, Android unit/lint checks and the SCA job on the pull request's generated merge commit. The earlier zero-step runner-allocation failure is no longer the release blocker.

Exact-release acceptance is still fail-closed: the release candidate must retain one consolidated green permanent-CI result. A workflow definition, an earlier commit's pass or a partial run does not substitute for that exact candidate result.

### SEC-008 — P2 — Dependency vulnerability / SCA evidence

**Status: executable and producing real PASS evidence on the merged stack; exact-release retention plus named reviewer sign-off remain mandatory.**

The release gate now:

- inventories the installed pnpm workspace dependency graph after a frozen-lockfile install;
- resolves Android transitive runtime/test/KSP Maven dependencies through Gradle rather than relying only on direct declarations;
- includes pinned Android/Kotlin/KSP build-plugin coordinates;
- queries OSV.dev directly for exact npm/Maven package versions;
- follows batch pagination and fetches full advisory records;
- fails closed on scanner/network/API errors;
- fails if either npm or Maven inventory is unexpectedly empty;
- treats `HIGH`, `CRITICAL` and severity-`UNKNOWN` findings as blockers;
- supports only exact package/version vulnerability acceptances with named approver, substantive reason and a maximum 90-day lifetime;
- invalidates an acceptance automatically when the dependency version changes;
- generates secret-safe machine-readable evidence under `artifacts/sca/`;
- runs as a permanent CI job and uploads evidence on both pass and failure.

The most recent retained technical evidence at the time of this review reports 13 findings: 0 critical, 0 high, 9 moderate, 4 low, 0 unknown, 0 accepted and 0 blocking. This is not described as a vulnerability-free dependency graph: moderate/low findings remain visible, and every release candidate must retain its own exact generated-merge-commit PASS manifest.

`docs/DEPENDENCY_SECURITY.md` defines the command, evidence format, acceptance policy and remediation workflow. SEC-008 is not fully signed off until the exact release candidate's PASS manifest has been reviewed by a named reviewer.

### SEC-009 — P1 — Repository merge-gate enforcement

**Status: open. `main` is currently unprotected and GitHub does not enforce required status checks or pull-request-only changes.**

The repository's CI, Android, SCA and recovery-smoke workflows are now executable and have passed on the integrated stack. However, repository policy does not currently prevent a future direct push or merge that bypasses those checks. That makes the release gate procedural rather than technically enforced.

Before a live-money pilot candidate is approved, protect `main` so at minimum:

- changes reach `main` through pull requests rather than direct pushes;
- the permanent CI checks are required before merge, including TypeScript/architecture, Android and SCA;
- the recovery smoke is required when its protected paths change;
- force pushes and branch deletion are disabled for normal maintainers;
- any emergency bypass is restricted, attributable and reviewed after use.

Branch protection is a repository-administration control and is not implemented by application code. A green workflow run is evidence that checks pass; it is not evidence that GitHub will require them on every future merge.

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
- dependency scanner/API failure produces FAIL rather than a clean release result;
- unaccepted HIGH/CRITICAL/UNKNOWN dependency finding blocks release;
- expired or version-mismatched SCA acceptance cannot suppress a finding;
- backup/restore drill reproduces representative release-candidate database truth and sequence safety;
- privileged inventory/close actions create immutable audit evidence;
- audit/ledger records cannot be mutated/deleted through application APIs;
- secrets/card data absent from logs/database/sample exports.

## Release disposition

**Current disposition: NO-GO for internet-exposed production/live-money pilot.**

SEC-001 through SEC-005 are merged into `main` and closed at application/code-review level. The fully integrated stack has also passed permanent TypeScript/build/lint/typecheck/tests/format/architecture, Android and fail-closed SCA gates, and the permanent synthetic backup/restore smoke has passed. Those results materially improve release confidence, but they do not convert deployment or operator evidence into code evidence. SEC-006 still lacks a representative signed restore PASS. SEC-005 still requires deployment-mode/flood evidence on the actual pilot topology. SEC-008 still requires exact-release evidence retention and named review. SEC-009 remains open because `main` is not protected, so future CI compliance is not repository-enforced.

Remaining mandatory release blockers are:

1. enable and verify `main` branch protection / required checks so release gates cannot be routinely bypassed (SEC-009);
2. execute a representative SEC-006 backup/restore drill on the exact release candidate, proving RPO/RTO/cadence and obtaining named operator/reviewer sign-off;
3. retain one consolidated green permanent TypeScript + format + architecture + Android + SCA result on the exact release candidate and obtain the required release review;
4. retain exact-release SEC-008 SCA PASS evidence with no unaccepted HIGH/CRITICAL/UNKNOWN finding and named review sign-off;
5. execute SEC-005 deployment abuse/flood evidence on the real pilot topology before live exposure;
6. complete the supported-device, event-network, Edge-hardware and provider fault/reconciliation evidence in `docs/PILOT_RUNBOOK.md`.

External OIDC/SSO/MFA is still recommended before graduating beyond a tightly controlled pilot, but the repository no longer trusts browser-supplied role/actor headers for operational authority.

After those mandatory blockers are closed, the correct next status is **controlled live pilot candidate**, not major-festival ready. Graduation criteria remain in `docs/PILOT_RUNBOOK.md`.
