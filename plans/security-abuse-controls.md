# Security remediation — HTTP abuse controls

Status: implementation in progress
Base: `security/human-auth-rbac` (PR #17)

## Objective

Close Task 010 SEC-005 without making Cloud availability depend on an attacker-controlled database hot row and without throttling legitimate Edge backlog drain or provider retry bursts.

## Layered model

1. **Application hard bounds**
   - explicit JSON/urlencoded body-size limits;
   - bounded inbound header/request/keep-alive timeouts;
   - existing machine batch cardinality limits remain authoritative (100 events per sync/inventory request).
2. **Per-process token buckets**
   - dual enforcement by source IP and caller fingerprint where a stable caller exists;
   - caller secrets are SHA-256 fingerprinted before use as bucket keys and are never logged;
   - policies differ for Edge sync, Edge payment calls, provider callbacks, operator reads, operator mutations and unauthenticated/public traffic;
   - capacity is intentionally generous for Edge replay/provider retries while still bounding runaway callers.
3. **Production upstream distributed protection**
   - per-process buckets are not represented as globally distributed protection;
   - multi-instance/internet production must terminate through a reviewed reverse proxy/WAF/API gateway with the documented equivalent limits;
   - production startup fails closed unless the deployment explicitly confirms the upstream abuse-control boundary.
4. **Operational evidence**
   - sampled structured warnings on rejects;
   - `429` with `Retry-After` and rate-limit headers;
   - pilot runbook includes reject monitoring and a burst exercise that proves local event operations remain independent.

## Default policy targets

Defaults are requests per minute per source/caller, with continuous token refill:

- Edge sync/inventory: 1,200/min (each request already max 100 business events).
- Edge payment machine traffic: 3,000/min.
- Provider callbacks: 1,200/min per provider/source.
- Operator reads: 1,200/min.
- Operator mutations: 240/min.
- Other/public traffic: 120/min.

Limits are configurable within bounded ranges for deployment tuning. `OPTIONS` is exempt from token consumption; body and server limits still apply.

## Security invariants

- Never use raw bearer/session/provider secrets as an in-memory key or log field.
- Never trust `X-Forwarded-For` unless the explicitly configured proxy-hop count is non-zero.
- An attacker cannot create unbounded bucket cardinality; idle buckets are purged and the store has a hard maximum.
- Rate limiting does not change payment truth. A rejected/timeout payment request is transport uncertainty to downstream callers, never automatic payment failure.
- Provider callback throttling must be high enough for legitimate retry bursts and duplicate callbacks; authoritative reconciliation still exists if a callback is delayed.
- Cloud abuse controls must not become a POS sale dependency; POS/Edge offline-first behavior is unchanged.
