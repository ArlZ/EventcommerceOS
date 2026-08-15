# Security remediation — human operator authentication and RBAC

Status: implementation complete; final green Cloud-payment machine-trust base merged; permanent CI revalidation in progress
Base: final `security/cloud-payment-machine-trust` at `93d3f56a1048ce149b98032dabb04b00ca0d3682`

## Objective

Replace caller-trusted administrative identity headers with revocable, expiring Cloud operator sessions whose actor, organisation membership and role are resolved server-side on every request.

## Implemented scope

- Cloud operator identity registry and organisation memberships.
- Opaque bearer sessions with cryptographically random 256-bit secrets; Cloud stores only SHA-256 digests.
- Session expiry, revocation and last-authenticated tracking.
- Global sanitization of caller-supplied actor/role headers.
- Server-derived organisation authority for configuration, command-centre, inventory operations and event-close HTTP routes.
- Human authorization for privileged payment operations without trusting request-body actor identity.
- Role-separated read, operational, configuration and financial authority.
- Cross-organisation/role/session adversarial HTTP coverage.
- Operator bootstrap/session lifecycle CLI with append-only audit.
- Control-web temporary-session bridge using `sessionStorage` and Cloud-origin-only bearer injection.
- Controlled-pilot operator access runbook.

## Roles

- `PLATFORM_ADMIN`: platform-wide administration and organisation creation.
- `ADMIN`: organisation administration, operational actions and event close/reopen; may read payment financial history but cannot create refunds/reversals.
- `FINANCE`: organisation-scoped refund/reversal mutation, payment history and financial close corrections.
- `SUPERVISOR`: organisation-scoped supervised operational actions and manual terminal confirmation where separately permitted.
- `VIEWER`: authenticated read-only operational access where explicitly allowed.

Roles are database memberships, never caller-supplied claims.

## Security invariants

- Bearer secrets are generated with 256 bits of randomness and printed only when a session is created.
- Token digests are unique; plaintext secrets are never persisted by Cloud.
- Revoked/expired/inactive identities fail closed.
- Organisation context is selected only through server-side membership; a request may identify a target organisation/resource but cannot assert its own role.
- Caller-supplied `x-actor-id` and `x-role` are stripped before controllers execute.
- Resource-scoped human requests authenticate the session before looking up event/payment ownership.
- Refund/reversal mutation requires `FINANCE` for organisation-scoped operators; general `ADMIN` authority is insufficient to move money.
- Privileged payment actor identity must match the authenticated session.
- Public HTTP does not accept a caller-supplied second refund approver.
- Machine Edge credentials cannot satisfy human authorization.
- Provider callbacks remain provider-authenticated and POS/Edge machine flows remain independent.
- Organisation creation requires `PLATFORM_ADMIN`.
- Manual terminal confirmation still requires the existing event-specific `PAYMENT_MANUAL_CONFIRM` permission.

## Acceptance coverage

The human-auth integration coverage now includes:

- legacy actor/role spoof without session -> denied;
- `VIEWER` cannot inflate itself to `ADMIN` with headers;
- correct membership accepted while wrong organisation is denied;
- organisation creation reserved for `PLATFORM_ADMIN`;
- expired/revoked session denied;
- revoked operator identity denied;
- Event Edge machine credential cannot satisfy a human route;
- `FINANCE` can read payment health but cannot mutate configuration;
- organisation `ADMIN` cannot create a refund or reversal and creates no adjustment rows;
- privileged payment body naming another actor is rejected before business effect;
- configuration, timestamp, command-centre and event-close integration fixtures use real operator sessions rather than an authentication bypass.

## Controlled-pilot UI boundary

Control-web exposes an **Operator session** control mounted at the root layout. The token is stored only in browser `sessionStorage`. A client-side fetch bridge strips obsolete `x-actor-id`/`x-role` headers and injects the operator bearer only for the configured Cloud API origin. Cloud CORS allows `Authorization`, `content-type` and the organisation scope selector.

This bridge is intentionally a controlled-pilot compatibility layer for existing client screens. A later UI hardening/refactor should move individual clients to a typed shared authenticated API client rather than relying on a global fetch bridge.

## Repository CI checkpoint

The final green PR #16 Cloud-payment machine-trust head has been merged into this branch. Three shared Command Centre/Event Close files conflicted during the ancestry relink. Both controllers retained this PR's server-derived operator-session authorization, while `CommandCentreService` retained this PR's text-safe sales-location/event joins, including the device/location join that remained UUID-cast on #16. All runtime `@Inject(...)` corrections and the previously proven Event Close behavior remain intact. The branch is now zero commits behind #16 and its diff is limited to the human-auth/RBAC feature boundary plus associated fixtures/docs.

A fresh permanent TypeScript + Android CI pass on this exact re-linked head is required before merge readiness.

## Non-goals / remaining blockers

This slice does **not** claim to solve:

- consumer/customer accounts;
- external OIDC/SSO or MFA;
- password storage/login;
- two-person refund approval UI/step-up;
- global abuse/rate limiting;
- backup/restore evidence;
- dependency/SCA evidence.

SEC-001 through SEC-004 are closed at code/review level across the stacked security branches, subject to permanent CI and merge. Overall release status remains NO-GO until abuse controls, restore evidence, permanent CI and SCA evidence are resolved.
