# Reliability — dependency-free runtime monitoring probe

Status: **in progress**
Base: `main` at `bae5eb9c549282ccbf571bb9d782d131d274a155`

## Objective

Add a provider-neutral external probe for deployed Cloud API, Event Edge and Control Web that can be scheduled by any monitoring platform, validates DB-backed readiness and exact release identity, emits low-cardinality Prometheus metrics, and fails non-zero on degradation without introducing a new runtime dependency or exposing sensitive request data.

## Scope

1. Add `scripts/runtime-monitor.mjs` with injectable fetch/time sources for deterministic tests.
2. Validate three health endpoint URLs; remote targets require HTTPS while localhost HTTP remains usable for synthetic smoke tests.
3. Require a full expected release SHA for Cloud API and Event Edge verification.
4. Measure probe success and latency without retaining endpoint URLs, credentials, query strings or response bodies in reports.
5. Support JSON and Prometheus output with service-only labels.
6. Exit non-zero if a service is unreachable, reports a non-ok status, reports the wrong service identity, or Cloud/Edge report the wrong release.
7. Add permanent tests for success, timeout/failure, release mismatch, unsafe URLs, bounded labels and secret non-retention.
8. Document provider-neutral alert recommendations and scheduling expectations.

## Acceptance criteria

- Probe is dependency-free and uses Node 22 built-ins only.
- Remote plaintext HTTP URLs are rejected; local HTTP is accepted for CI/local use.
- URLs containing credentials, query strings or fragments are rejected.
- Expected release must be a lowercase full 40-character Git SHA.
- Prometheus output uses only the bounded `service` label.
- JSON output contains no configured endpoint URL or unrelated environment secret.
- Any failed probe yields overall `BLOCKED` and CLI exit code 1.
- Existing TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not select or configure a hosted monitoring vendor.
- Do not add high-cardinality application/business metrics in this slice.
- Do not claim pager/notification delivery is operational until a real deployment monitoring stack exists.
- Do not treat synthetic health monitoring as controlled-pilot field evidence.
