# Codex Task 011 — Identity, Device Trust & Pilot Security Gate

Treat this as closure of the live-pilot blockers discovered in Task 010. Do not add unrelated commerce features.

## Objective

Make caller identity trustworthy across Cloud, Event Edge and POS sync while preserving the offline-first sale invariant.

Cloud must never become a synchronous dependency for local POS authentication or checkout.

## Required security model

### Operator identity

- operator/admin API authority must come from an authenticated credential/session, not caller-supplied actor/role/organisation headers;
- credentials are high-entropy, stored only as hashes, expire and can be revoked;
- Cloud derives actor, organisation and role from authenticated credential truth;
- Event Edge can authenticate authorized event operators locally while disconnected by installing a signed/verified security snapshot;
- privileged inventory/payment/close actions use the authenticated actor identity, not a body-supplied actor override.

### Device identity

- every POS device has a unique credential tied to organisation, event, sales location and device ID;
- Event Edge validates the credential locally before accepting device sync/payment traffic;
- envelope `deviceId` must match the authenticated device principal;
- device credentials can be revoked/rotated; stale signed snapshots cannot roll Edge security state backwards.

### Event Edge service identity

- every Event Edge service has a unique Cloud credential tied to organisation/event/edge ID;
- Edge→Cloud sync and Cloud payment orchestration calls are authenticated;
- Cloud verifies `edgeId`/event scope against the authenticated Edge principal before ingestion/action.

### Provider callbacks

Provider callback routes remain provider-facing. Do not require operator/device tokens on callback routes. Preserve current provider-specific verification/reconciliation rules.

## Implementation constraints

- use Node built-in cryptography; do not introduce a dependency solely for credential generation/hashing;
- raw bearer secrets are returned only at provisioning/rotation time and never persisted;
- compare secret hashes using timing-safe comparison;
- no credentials in logs/audit payloads;
- security snapshot contains hashes/claims only, never raw secrets;
- signed snapshot has explicit schema/version/generated-at and Event Edge refuses rollback to an older installed version;
- network TLS remains required outside loopback; authentication does not replace TLS;
- retain existing money/stock/payment idempotency semantics;
- no authentication call from POS to Cloud in the synchronous sale path.

## Provisioning / bootstrap

Provide a narrowly scoped bootstrap path for creating the first operator credential. It must:

- be disabled unless an explicit runtime bootstrap secret is configured;
- compare the bootstrap secret timing-safely;
- never have a default secret;
- be clearly documented as provisioning-only and removable/disabled after bootstrap.

Authenticated operators may then provision/revoke/rotate device and Event Edge credentials and export the signed Event Edge security snapshot.

## Edge security snapshot

The Event Edge must install a signed security snapshot containing the active credentials needed for that event:

- operator credential hashes + actor/organisation/role/expiry;
- device credential hashes + device/event/sales-location/expiry;
- snapshot version/generated-at/event/organisation.

Installation must authenticate the snapshot independently from the operator that transports it and reject wrong-event, invalid-signature, expired/revoked-entry and rollback cases.

## Route protection

Classify routes explicitly:

- `PUBLIC_HEALTH` — health only;
- `PROVIDER_CALLBACK` — provider callbacks, with provider-specific verification;
- `OPERATOR` — administrative/control/event-close/refund/reversal/privileged reads;
- `DEVICE` — POS→Edge sync/payment initiation/read as appropriate;
- `EDGE_SERVICE` — Edge→Cloud sync/payment orchestration;
- provisioning bootstrap — its own tightly constrained bootstrap-secret rule.

Prefer secure-default route classification. A new operational route should not become public accidentally.

## Abuse controls

Add bounded in-process pilot rate limiting as a defensive layer and document that production should additionally enforce gateway/reverse-proxy request-size/rate limits. Rate limiting must never be a Cloud dependency for local checkout.

## Security acceptance tests

At minimum cover:

- forged `x-role`/`x-actor-id` without a valid credential denied;
- malformed/expired/revoked operator token denied;
- server-derived actor/org/role cannot be overridden by headers/body;
- cross-organisation operator access denied;
- unknown/revoked device credential denied at Event Edge;
- device credential cannot submit another device ID;
- security snapshot invalid signature denied;
- older snapshot rejected after newer snapshot installed;
- revoked device disappears after current snapshot install;
- Edge service credential required for Cloud sync;
- Edge credential cannot claim another `edgeId` or another event;
- Edge→Cloud payment call requires Edge service identity;
- provider callbacks still reach provider-specific verification without operator auth;
- privileged inventory actor is derived from authenticated operator;
- bootstrap path unavailable without configured bootstrap secret;
- credential provisioning/rotation/revocation audit contains IDs/actors but no raw secret;
- rate limit returns 429 without changing domain state;
- offline POS local order durability tests remain unchanged/passing.

## Documentation

Update `docs/SECURITY_RELIABILITY.md` and `docs/PILOT_RUNBOOK.md` with the implemented credential/snapshot/provisioning/revocation model and remaining production limitations.

## Non-goals

- SSO/OIDC enterprise federation;
- consumer login/accounts;
- biometrics;
- device MDM;
- new payment rails;
- new inventory features;
- major-festival readiness claim.

## Merge discipline

Base this task on Task 010. Keep it stacked/draft until the lower-stack permanent TypeScript + Android CI jobs actually execute and pass. Security work does not waive the existing CI gate.
