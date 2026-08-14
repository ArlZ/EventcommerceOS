# Release Hardening & Simulation Evidence

Status: **automated reliability model passes; live pilot release is blocked**

This document records Task 010 production-hardening evidence. It is intentionally conservative: passing deterministic simulation does not establish production readiness, hardware performance, network reliability, provider behavior, security accreditation or PCI scope.

## 1. Release verdict

### Deterministic reliability model

**PASS** for the modeled invariants in Task 010:

- locally acknowledged orders remain durable during Cloud, Edge and POS connectivity faults;
- recovery drains device/Edge backlogs to zero in all configured scenarios;
- duplicate/replayed events produce zero duplicate protected business effects;
- delayed/duplicate payment callbacks create explicit `UNKNOWN` uncertainty and later reconcile without invented failure;
- notification-provider failure does not change order or inventory durability;
- Edge and Cloud inventory converge after recovery;
- dashboard lag catches up after the source paths recover;
- transfers have one modeled business effect;
- the simulator remains deterministic from a seed and labels its latency evidence as synthetic/model-only.

### Live pilot release

**BLOCKED** until the security/trust and operational evidence items below are completed.

A major-festival deployment is **not approved** by this task.

## 2. Simulation profile

The default release-gate model represents materially more activity than a small pilot:

- 8 bars;
- 6 registers per bar / 48 POS devices;
- 18 generated transactions per second;
- 120 seconds of active event traffic;
- 120 seconds of post-fault recovery;
- three-product mix with a configurable demand spike;
- cash, M-PESA and Pesapal Sabi payment mix;
- configurable Edge and Cloud ingestion capacity;
- virtual 100 ms ticks and deterministic pseudo-random selection.

This is a logic/load **model**, not a process/network benchmark against deployed NestJS/PostgreSQL/Android components.

## 3. Required scenario evidence

| Scenario | Key evidence |
| --- | --- |
| Cloud outage while event continues | 2,160 local orders retained; modeled max sync backlog ~1,890; backlog drains after Cloud recovery; zero duplicate effects |
| Edge→Cloud partition | Event-side processing continues; Cloud backlog builds and fully converges after recovery |
| POS isolation/reconnect | Isolated devices retain durable local outboxes; queued sales reach Edge/Cloud after reconnect |
| Edge restart under backlog | Processing pauses without deleting queued work; backlog drains after restart window |
| Large sync replay | Entire queued sale set is delivered twice; 2,000+ duplicate deliveries are ignored with zero second business effect |
| Payment callback delay/duplication/reordering | `UNKNOWN` rises under delayed truth; duplicate callback identities are ignored; all attempts resolve after recovery; false failures = 0 |
| Popular-product demand spike | SKU mix concentrates strongly on the target product while ordering and convergence continue |
| Concurrent sales + transfer | One replenishment transfer effect is applied while sales continue; Edge/Cloud stock converges |
| Notification outage | Notification failures accumulate while sales/inventory continue and converge |
| Slow/degraded dependency | Capacity reduction creates a substantial backlog; configured recovery window drains it fully |
| WAN failover | Cloud path is unavailable during failover delay, then resumes; backlog and dashboard lag converge |

Representative deterministic values from the implementation review include:

- Cloud outage max backlog: ~1,890 events; modeled drain ~17.1 s;
- full isolated/replay case max backlog: ~2,070 events; ~2,070 duplicate deliveries ignored;
- slow dependency max backlog: ~967 events; modeled drain ~8.7 s;
- payment callback chaos: >2,000 duplicate callbacks ignored in the model, with `UNKNOWN` returning to zero;
- all scenarios: duplicate protected business effects = 0, final sync backlog = 0, final payment `UNKNOWN` = 0, inventory converged.

Exact values are deterministic for the committed scenario seeds but are not production SLO measurements.

## 4. What the simulation does **not** prove

The modeled local-commit p95 is a simulator cost and must not be reported as Android performance. Before a live pilot, separately measure:

- product-grid p95 on the supported POS device;
- SQLite commit/outbox p95 on that device under realistic history size;
- access-point contention, roaming and reconnect behavior;
- Event Edge PostgreSQL ingest and restart behavior on selected hardware;
- real Cloud database throughput/pool saturation;
- control dashboard lag against the deployed stack;
- provider sandbox/test-terminal timing and failure semantics;
- real primary-WAN/cellular failover.

The engineering targets remain the baseline in `SECURITY_RELIABILITY.md`, including local product interactions p95 <150 ms and local committed mutation p95 <250 ms on supported hardware.

## 5. Threat-focused release review

### BLOCKER A — operator/admin identity is not authenticated

Cloud administrative context currently trusts caller-supplied `x-actor-id`, `x-role` and `x-organisation-id` headers after format/role checks. Those headers provide useful internal context and organisation isolation, but they do **not** prove who sent the request.

Consequences if the Cloud API is publicly reachable before a real authentication layer is added:

- a caller could claim `ADMIN`/`PLATFORM_ADMIN`;
- audit actor identity could be forged;
- control/event-close actions would be attributable to an unverified identity;
- payment reads/mutations that do not currently use this admin context are even less protected.

Required before pilot:

- authenticated operator session/access token;
- server-derived actor, organisation and roles/permissions;
- short-lived access token + secure refresh/revocation strategy;
- step-up/supervisor mechanism for configured high-risk actions;
- tests proving spoofed identity/role headers cannot grant authority.

Do not expose internal Cloud management/payment mutation routes directly to an untrusted network while this blocker exists.

### BLOCKER B — device and Event Edge identity/registration/revocation are not established

Current sync controllers validate envelopes and idempotency but do not authenticate the sending device/Edge:

- POS→Event Edge `POST /sync/device-events` accepts a structurally valid batch without a device credential;
- Event Edge→Cloud `POST /sync/edge-events` accepts a structurally valid batch without an Edge credential;
- Edge HTTP transport requires HTTPS outside loopback, but sends only `content-type`, not an Edge identity credential.

No production device-registration/revocation model is present in the current Cloud configuration schema.

Required before pilot:

- controlled device enrollment tied to organisation/event/sales location;
- per-device credential or mutually authenticated channel, securely stored on the device;
- Event Edge service identity for Cloud sync;
- revocation/rotation and lost-device procedure;
- Cloud/Edge reject unregistered or revoked identities before domain ingestion;
- server verifies the envelope `deviceId` belongs to the authenticated device identity;
- audit enrollment/reassignment/revocation;
- replay-safe credential rotation test.

Network segmentation is an additional defense, not a substitute for sender identity.

### BLOCKER C — privileged Edge actor identity can be spoofed

Inventory services correctly query event-level permissions such as `INVENTORY_MOVE`, `TRANSFER_MANAGE`, `COUNT_MANAGE` and `ALERT_MANAGE`. However, controller validation currently parses `actorId` directly from request bodies. The configuration-snapshot endpoint that installs permissions is also unauthenticated at the network boundary.

Required before pilot:

- authenticated operator/device session at Event Edge;
- derive the acting user from the verified session rather than request body;
- permission snapshot installation restricted to authenticated/configuration-sync authority;
- tests for forged actor IDs and permission-snapshot tampering.

### BLOCKER D — payment operational/mutation endpoints need platform auth

Cloud and Edge payment controllers expose initiation, reconciliation, manual terminal confirmation, refund/reversal/history and health surfaces without a general authenticated caller boundary. Inner payment services contain strong idempotency, permission and audit rules, but request provenance must be authenticated before those rules can be trusted.

Required before pilot:

- authenticate POS/Edge payment initiation as the registered device/event context;
- authenticate operator/supervisor payment adjustments and reconciliation actions;
- server-derived actor identity for manual terminal evidence;
- deny direct internet access to internal operational payment routes where not required.

Provider callback routes remain provider-facing and must use provider-specific verification rather than operator sessions.

### BLOCKER E — rate limiting / abuse controls are not present

The current Nest bootstrap and reviewed controllers do not show a rate/abuse-control layer. Public provider callbacks, authentication endpoints once introduced, and operational mutation endpoints need bounded request behavior.

Required before pilot:

- reverse-proxy/API gateway request size and rate limits;
- callback-specific limits that do not drop legitimate provider retries;
- stricter limits on manual/privileged mutation routes;
- monitoring for authentication failures, rejected callbacks and sync abuse;
- load test that demonstrates limits fail safely without affecting local POS order creation.

## 6. Positive security/reliability controls already present

The blockers above should not obscure controls that are already correctly designed:

- local POS order state + outbox are committed transactionally before network success;
- sync uses stable event identity and explicit conflict handling rather than money/stock last-write-wins;
- payment attempts are immutable/history-preserving and initiation is idempotent;
- provider timeout/transport ambiguity becomes `UNKNOWN` rather than invented decline;
- M-PESA callbacks are treated as reconciliation signals instead of settlement truth;
- Pesapal Sabi callback credentials use timing-safe comparison and transaction truth is independently verified with Pesapal before settlement is accepted;
- raw PAN/CVV/PIN/track/EMV/cryptogram fields are rejected at payment boundaries;
- manual terminal approval is restricted to the dedicated external-terminal flow and retains append-only evidence;
- inventory is append-only ledger based;
- physical count produces a variance adjustment rather than overwriting stock;
- inventory actions use explicit event permission checks and attributable actor fields;
- event close creates immutable numbered report revisions; late truth never rewrites a prior close report;
- Edge→Cloud sync refuses cleartext HTTP outside loopback development.

## 7. Dependency and automated security check status

The repository's normal TypeScript/Android CI remains externally blocked at GitHub Actions account/billing level: rerun jobs are created but terminate with zero workflow steps and no job-log blob. Therefore permanent CI has **not** passed and must not be represented as passed.

Task 010 source/simulator code was mechanically type-checked in an isolated Node 22 / TypeScript 5.8 environment and the deterministic scenario suite executed successfully. That is supplemental evidence only.

A network-backed package vulnerability audit could not be treated as authoritative from the current execution environment. Before pilot, run and retain evidence for:

```text
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm check
./gradlew test lint
```

Also run the organisation's preferred secret/dependency scanner and container/image scanner against the actual deployment build. Any high/critical exploitable finding requires remediation or an explicitly approved risk record.

## 8. Operational evidence still required before pilot

In addition to resolving Blockers A–E:

1. permanent repository CI green on the final merge stack;
2. supported Android hardware durability/latency test, including kill/restart after random commits;
3. real Event Edge hardware restart under accumulated backlog;
4. real AP isolation/reconnect and roaming test;
5. M-PESA sandbox and Pesapal Sabi test-terminal end-to-end evidence;
6. primary WAN failure and cellular failover rehearsal;
7. PostgreSQL backup + restore rehearsal with recorded recovery time;
8. monitoring/alert routing rehearsal;
9. event close/reopen/reconciliation rehearsal with late provider truth;
10. operator training and a controlled small live pilot.

## 9. Graduation rule

The platform may move from **engineering build** to **controlled pilot candidate** only when:

- security Blockers A–E are closed;
- permanent CI passes;
- pre-pilot hardware/network/provider rehearsals pass;
- a named incident lead and fallback plan are ready.

The platform may move from **controlled pilot** to a materially larger event only after the pilot produces evidence of:

- zero lost acknowledged orders;
- zero duplicate financial/stock business effects;
- acceptable measured POS latency;
- complete post-partition convergence;
- all payment `UNKNOWN` cases reconciled with traceable outcomes;
- explainable cash and inventory variance;
- successful close/reconciliation;
- no unresolved Sev-1/Sev-2 security/reliability incident.

A successful simulator run alone never satisfies this graduation rule.
