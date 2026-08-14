# Security remediation — Event Edge to Cloud trust

Status: implementation complete; permanent CI pending
Base: Task 010 (`codex/task-010-production-hardening`)

## Objective

Close the anonymous machine-ingress boundary between Event Edge and Cloud without inventing user authentication or weakening the offline-first event path.

This slice authenticates and tenant-binds both Edge-originated Cloud ingestion routes:

- `POST /sync/edge-events`;
- `POST /inventory/edge-events`.

## Trust model

- Each Event Edge has a stable `EDGE_ID`.
- Cloud provisions a cryptographically random 256-bit bearer credential for that Edge.
- Cloud stores only the SHA-256 digest; the plaintext credential is printed once by the operator CLI.
- Credential digests are unique across Edge identities.
- Requests outside loopback development require HTTPS at the Event Edge transport boundary.
- `x-edge-id` is only a lookup identifier. Possession of the bearer credential authenticates the Edge.
- Cloud derives organisation membership from `edge_sync_clients`; it never accepts organisation identity from the Edge request.
- Every business `eventId` in an authenticated order-sync or inventory batch must belong to the Edge's server-side organisation.
- The body `edgeId` must equal the authenticated Edge identity.
- Credential comparisons use constant-time digest comparison.
- Revoked credentials fail closed on the next Cloud request.

## Credential lifecycle

Operator commands use `pnpm --filter @event-commerce/cloud-api edge-credential -- <action>` with `DATABASE_URL`, `EDGE_ID` and `EDGE_CREDENTIAL_ACTOR` set. Provision additionally requires `EDGE_ORGANISATION_ID`.

Supported actions:

- `provision` — creates a new active Edge identity and outputs `EDGE_ID` plus one-time `EDGE_CLOUD_SYNC_TOKEN`;
- `rotate` — replaces the digest, increments credential version, writes audit, and outputs a new one-time token;
- `revoke` — marks the Edge revoked and writes audit.

Rotation invalidates the prior credential immediately. Until the new secret is installed at the Edge, durable Cloud outboxes may accumulate and retry; local POS ordering and Event Edge inventory operations remain independent of Cloud reachability.

## Audit and attribution

- `edge_sync_client_audit` is append-only for provision/rotate/revoke actions.
- Cloud records `last_authenticated_at` on successful machine authentication.
- Accepted order/sync events record authenticated `edge_id` and `organisation_id`.
- Cloud device health state records the authenticated Edge and organisation that last relayed it.
- Device ID takeover across organisations is rejected rather than overwriting existing attribution.
- Device sequence replay checks are scoped by organisation, preventing one tenant from creating sequence conflicts for another tenant.

## Security acceptance coverage

The integration suite covers:

- missing bearer credential -> `401`;
- invalid credential -> `401`;
- unknown Edge -> `401`;
- request-body Edge mismatch -> `401`;
- revoked Edge -> `401`;
- rotated old credential -> `401`, new credential -> accepted;
- event outside Edge organisation -> `401` before durable business effect;
- accepted sync event/device state attributed to Edge + organisation;
- cross-organisation device-ID takeover -> `409` with transaction rollback;
- identical device sequence numbers in different organisations do not conflict;
- inventory Edge ingestion uses the same authentication and tenant binding;
- Event Edge runtime transport fails closed when credential is missing or batch identity mismatches.

## Non-goals / remaining blockers

This slice does **not** claim to solve:

- POS device enrolment/revocation or device-to-Edge authentication;
- human/operator sessions or server-derived RBAC;
- payment API authentication/authorization;
- caller-supplied admin role/header replacement;
- global rate limiting/abuse controls;
- backup/restore evidence;
- dependency/SCA evidence;
- permanent CI, currently blocked before runner assignment.

Those remain release blockers. The system remains NO-GO for internet-exposed live-money production until the wider Task 010 security disposition is cleared.
