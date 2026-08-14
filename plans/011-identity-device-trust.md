# Task 011 — Identity, Device Trust & Pilot Security Gate

Status: in progress

## Objective

Close Task 010 live-pilot trust blockers without adding Cloud dependencies to local checkout.

## Architecture decision

Use high-entropy opaque credentials of the form `<credential-id>.<secret>`:

- credential ID is public lookup material;
- secret is generated with Node `crypto.randomBytes` and returned only on create/rotate;
- only SHA-256 secret hash is stored;
- hash comparison uses `timingSafeEqual`;
- credentials include explicit expiry/revocation and principal scope.

Cloud stores authoritative operator/device/Edge credential records.

Event Edge stores a local security snapshot for the event containing only credential hashes and claims needed to authenticate operators/devices while offline. Snapshot transport is integrity-protected with a deployment HMAC signing secret and includes a monotonically increasing snapshot version; Edge rejects rollback.

Event Edge service credentials are provisioned in Cloud and the raw secret is installed into Edge runtime configuration. Edge uses it for authenticated Edge→Cloud sync/payment orchestration. The secret itself is never part of the security snapshot.

## Principal types

### OPERATOR

Cloud claims:
- credential ID;
- actor ID;
- organisation ID;
- role (`ADMIN` or `PLATFORM_ADMIN` initially);
- expiry/revocation.

Cloud derives administrative context from the authenticated credential. Caller `x-actor-id`, `x-role`, `x-organisation-id` are ignored/overwritten for authority.

Event Edge snapshot includes active organisation operators. Edge derives actor ID from credential and existing event permission tables continue to make the domain authorization decision.

### DEVICE

Claims:
- credential ID;
- organisation ID;
- event ID;
- sales-location ID;
- device ID;
- expiry/revocation.

Edge rejects device sync if batch/device event IDs do not match the authenticated device.

### EDGE_SERVICE

Cloud claims:
- credential ID;
- organisation ID;
- event ID;
- Edge ID;
- expiry/revocation.

Cloud rejects Edge sync if batch `edgeId` differs from authenticated Edge ID. Cloud payment orchestration invoked by Event Edge requires the same service principal.

## Cloud module

Add `apps/cloud-api/src/security` with:

- credential token parser/generator/hash comparison;
- Cloud credential repository/authentication service;
- provisioning/revocation/rotation service;
- signed snapshot export;
- route guard/decorators and request principal attachment;
- bootstrap controller for first operator only;
- authenticated security-management controller;
- bounded in-process rate limiter.

Migration `0011_security_credentials.sql` stores credential metadata/hash/audit-support indexes.

## Event Edge module

Add `apps/event-edge/src/security` with:

- local security snapshot tables/migration;
- snapshot verifier/installer with version rollback protection;
- device/operator credential verification from local DB;
- route guard/decorators and server-derived principal;
- helper for authenticated Edge→Cloud request headers;
- bounded local rate limiter.

## Route changes

Cloud:
- health → public;
- provider callbacks → provider callback classification;
- Edge sync/payment initiation/reconciliation from Edge → EDGE_SERVICE;
- configuration/command-centre/event-close/security management/refunds/reversals/privileged payment reads → OPERATOR;
- bootstrap operator → bootstrap-secret-only.

Event Edge:
- health → public;
- device sync and POS payment initiation/read → DEVICE;
- inventory and manual terminal supervision → OPERATOR;
- security snapshot installation → signed snapshot validation;
- background Edge→Cloud calls add EDGE_SERVICE credential.

## Compatibility strategy

Do not preserve insecure authority as a production fallback. Tests/dev environments must explicitly provision credentials or use test helpers. There is no default operator/device/Edge secret.

The old `adminContextFromHeaders` may remain as a shape validator/internal helper only after a security guard has server-derived/overwritten the headers; unguarded callers must not gain authority from it.

## Rate limits

Use bounded per-principal/IP fixed-window limits sufficient for pilot defense. Reverse proxy/API gateway remains required for production-grade distributed limiting/request-size enforcement.

## Acceptance

See `prompts/CODEX_TASK_011.md`. Highest-risk tests:

- actor/role/header spoofing;
- token expiry/revocation;
- device ID mismatch;
- Edge ID/event mismatch;
- snapshot signature/rollback;
- provider callback exemption;
- body actor override ignored;
- secure bootstrap disabled by default;
- no raw secret persistence/audit;
- offline POS tests unaffected.

## Stack

Base: Task 010 / PR #12.

Keep draft and do not merge any stack until permanent GitHub TypeScript + Android workflows execute and pass.
