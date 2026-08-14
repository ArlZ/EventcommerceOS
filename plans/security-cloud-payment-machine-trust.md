# Security remediation — Cloud payment machine trust

Status: implementation complete; permanent CI pending
Base: POS device trust (`security/pos-edge-trust`, PR #15)

## Objective

Close anonymous Cloud payment access without granting Event Edge or POS machine credentials human financial authority.

## Caller split

### Event Edge machine credential

The existing revocable Event Edge credential protects these Cloud routes:

- `POST /payments/initiate`
- `POST /payments/attempts/:paymentAttemptId/reconcile`
- `GET /payments/providers/availability`
- `GET /payments/orders/:orderId`

Cloud derives organisation membership from `edge_sync_clients`. Payment initiation is authorized against the requested event. Attempt/order reads and reconciliation are allowed only when the payment belongs to the authenticated Edge organisation.

Event Edge attaches `Authorization: Bearer ...` and `x-edge-id` only when making the HTTP request. Credentials are not placed in payment cache records, POS requests or durable sync/inventory outboxes.

### Payment provider callbacks

`POST /payments/providers/:providerId/callback` retains provider-specific verification. It is not authenticated as Event Edge traffic.

### Human-only operations

Until a real user session/RBAC layer exists, the public Cloud controller fails these routes closed with `403`:

- manual terminal confirmation;
- refund;
- reversal;
- payment adjustment history;
- manual terminal evidence history;
- event payment health.

The anonymous Event Edge manual-terminal-confirmation route is removed as well. The underlying services remain available internally for business-rule tests and for a future authenticated human controller.

This intentionally makes supervised external-terminal confirmation unavailable through HTTP during the security remediation stack. That is safer than retaining an unauthenticated financial override.

## Reliability behavior

- Missing/invalid Cloud machine credentials do not invent payment failure.
- An ambiguous Edge→Cloud initiation remains explicit `UNKNOWN` at Edge and is reconciled using the original attempt after connectivity/credential repair.
- Rail-health failure is reported as degraded and does not disable local order building or cash operation.
- Provider callbacks remain independent of Event Edge reachability.

## Acceptance coverage

- unauthenticated Cloud initiation rejected before durable payment creation;
- authenticated Edge can initiate for its own event;
- Edge cannot initiate for another organisation's event;
- order payment read denied cross-organisation;
- reconciliation denied cross-organisation;
- rail availability requires active Edge credential;
- privileged human payment routes return `403` even when an Edge credential is supplied;
- Event Edge payment initiation/reconciliation requests include the configured Edge credential;
- Event Edge rail-health call uses the same credential;
- formerly anonymous Event Edge manual-confirmation route is absent;
- existing payment state/cache/idempotency tests remain service-level and unchanged in authority semantics.

## Remaining blockers

This slice does not solve human identity. Remaining release blockers include:

- server-issued human sessions and authoritative organisation/role membership (SEC-003);
- re-enabling privileged payment operations behind that human authorization;
- replacing caller-supplied admin role/organisation headers across configuration, command centre, inventory and event close;
- global abuse/rate limiting;
- backup/restore evidence;
- permanent CI;
- dependency/SCA evidence.

Overall release disposition remains **NO-GO for live-money production**.
