# Security remediation — human operator authentication and RBAC

Status: planned
Base: `security/cloud-payment-machine-trust` (PR #16)

## Objective

Replace caller-trusted administrative identity headers with revocable, expiring Cloud operator sessions whose actor, organisation membership and role are resolved server-side on every request.

## Scope

- Cloud operator identity registry and organisation memberships.
- Opaque bearer sessions with cryptographically random secrets; Cloud stores only SHA-256 digests.
- Session expiry, revocation and last-authenticated tracking.
- Server-derived `AdminContext` for configuration, command-centre and event-close HTTP routes.
- Human authorization for privileged payment operations without trusting request-body `actorId`.
- Cross-organisation and insufficient-role denial tests.
- Operator bootstrap/session lifecycle CLI with append-only audit.

## Roles

- `PLATFORM_ADMIN`: platform-wide administration.
- `ADMIN`: organisation administration and event operations.
- `FINANCE`: organisation-scoped payment refund/reversal/history/health authority.
- `SUPERVISOR`: organisation-scoped supervised manual terminal confirmation authority.
- `VIEWER`: authenticated read-only operational access where explicitly allowed.

Roles are database memberships, never caller-supplied claims.

## Security invariants

- Bearer secrets are generated with 256 bits of randomness and printed only when a session is created/rotated.
- Token digests are unique; plaintext secrets are never persisted.
- Revoked/expired/inactive identities fail closed.
- Organisation context is selected only from server-side membership; a request may identify a target organisation/resource but cannot assert its own role.
- Privileged payment `actorId` is derived from the authenticated session. Any body actor field is removed from the HTTP trust boundary or required to match the authenticated actor before service invocation.
- Machine Edge credentials cannot satisfy human authorization.
- Provider callbacks remain provider-authenticated and POS/Edge machine flows remain independent.

## Non-goals

- Consumer/customer accounts.
- External OIDC/SSO integration.
- Password storage or password login.
- MFA (deployment may add an external IdP later without changing business authorization semantics).
- Global abuse/rate limiting, backup/restore evidence, SCA or CI billing remediation.
