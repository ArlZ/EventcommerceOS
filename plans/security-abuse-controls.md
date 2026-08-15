# Security remediation — HTTP abuse controls

Status: implementation complete; repository CI revalidation in progress; deployment abuse evidence remains pending
Base: `security/human-auth-rbac` (PR #17)

## Objective

Close Task 010 SEC-005 without making Cloud availability depend on an attacker-controlled database hot row and without throttling legitimate Edge backlog drain or provider retry bursts.

## Implemented layered model

1. **Application hard bounds**
   - explicit JSON/urlencoded body-size limits on Cloud and Event Edge;
   - bounded inbound header/request/keep-alive timeouts and header count;
   - existing machine batch cardinality limits remain authoritative (100 events per sync/inventory request).
2. **Per-process sustained-rate and burst controls**
   - dual enforcement by source IP and caller fingerprint where a stable caller exists;
   - caller secrets are SHA-256 fingerprinted before use as bucket keys and are never logged;
   - policies differ for Edge sync, Edge payment calls, provider callbacks, operator reads, operator mutations and unauthenticated/public traffic;
   - immediate burst is intentionally lower than the full minute allowance so a caller cannot dump one minute of work at once;
   - abuse throttling executes before operator-session database authentication.
3. **Per-policy in-flight concurrency ceilings**
   - global per-process in-flight caps bound instantaneous work even across many source addresses;
   - Cloud and Event Edge return `429` rather than allowing unbounded concurrent handler work;
   - Event Edge enforcement remains entirely local and has no Cloud dependency.
4. **Production upstream distributed protection**
   - per-process buckets/concurrency caps are not represented as globally distributed protection;
   - multi-instance/internet production must terminate through a reviewed reverse proxy/WAF/API gateway with the documented equivalent source/burst limits;
   - production startup fails closed unless the deployment explicitly declares `single_instance_pilot` or confirms the distributed upstream boundary.
5. **Operational evidence**
   - sampled structured rate-reject warnings;
   - `429` with `Retry-After`, rate/burst metadata and concurrency ceiling metadata;
   - pilot runbook requires reject monitoring plus sustained, instantaneous-burst and concurrent-work exercises that prove local event operations remain independent.

## Default Cloud policies

| Policy | Requests/minute | Burst | Max in-flight |
| --- | ---: | ---: | ---: |
| Edge sync/inventory | 1,200 | 120 | 64 |
| Edge payment | 3,000 | 300 | 128 |
| Provider callback | 1,200 | 200 | 128 |
| Operator read | 600 | 60 | 128 |
| Operator mutation | 120 | 30 | 32 |
| Public/other | 120 | 30 | 64 |

## Default Event Edge policies

| Policy | Requests/minute | Burst | Max in-flight |
| --- | ---: | ---: | ---: |
| POS device sync | 1,800 | 180 | 64 |
| POS device payment | 1,200 | 120 | 192 |
| Other LAN HTTP | 300 | 60 | 64 |

Limits are configurable only within bounded ranges. `OPTIONS` is exempt from token/concurrency accounting; body and server limits still apply.

## Security invariants

- Never use raw bearer/session/provider secrets as an in-memory key or log field.
- Never trust `X-Forwarded-For` unless the explicitly configured proxy-hop count is non-zero.
- An attacker cannot create unbounded bucket cardinality; the in-memory stores have hard maxima and least-recently-touched eviction.
- Random fake `ecom_op_` sessions are rate-limited before operator authentication reaches PostgreSQL.
- Rate/concurrency rejection does not change payment truth. A rejected/timeout payment request is transport uncertainty to downstream callers, never automatic payment failure.
- Provider callback throttling preserves a high retry allowance; authoritative reconciliation still exists if a callback is delayed.
- Cloud abuse controls must not become a POS sale dependency; POS/Edge offline-first behavior is unchanged.
- Event Edge abuse decisions are local and do not depend on Cloud or a distributed rate-limit service.

## Acceptance coverage

Cloud tests cover:

- burst depletion and continuous refill;
- in-flight cap independent of token rate;
- caller/route policy classification;
- bearer secret fingerprinting;
- `429`/`Retry-After`/rate metadata;
- deterministic security ordering: abuse protection before operator DB authentication;
- authentication is not invoked after an abuse rejection.

Event Edge tests cover:

- POS sync/payment/local route classification;
- device credential fingerprinting;
- immediate-burst `429` behavior;
- device-payment in-flight cap.

## Repository CI checkpoint

- The first real runner pass failed only on cross-stack TypeScript import/DI hygiene: Nest constructor tokens had been converted to type-only imports, and two test helpers still used value imports only as types.
- The DI-safe source fixes, stale auth/payment/FK integration fixtures, and deterministic shared-database test execution were proven on the green PR #19 stack and have now been backported here without bringing backup/restore implementation or SCA scope into this PR.
- A fresh permanent TypeScript + Android CI pass on this branch is required before merge readiness.

## Remaining release evidence

Code-level SEC-005 remediation is complete, but live exposure still requires:

- permanent TypeScript/Android CI on the exact stacked commit;
- the `docs/ABUSE_PROTECTION.md` pilot abuse exercise on the real topology;
- retained HTTP `429`/reject/concurrency evidence;
- if using `upstream_distributed`, evidence of the actual upstream WAF/API gateway/reverse-proxy configuration rather than only the confirmation environment variable.

The overall release remains NO-GO until the remaining Task 010 blockers—backup/restore evidence, green permanent CI, dependency/SCA evidence, and real abuse-test evidence—are closed.