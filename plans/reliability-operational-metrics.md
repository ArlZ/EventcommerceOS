# Reliability — operational metrics and alerting contract

Status: **in progress**
Base: `main` at `bae5eb9c549282ccbf571bb9d782d131d274a155`

## Objective

Add provider-neutral, low-cardinality operational metrics for Cloud API and Event Edge so pilot operators can monitor runtime health and alert on service/database/HTTP degradation without exposing tenant, event, order, payment or customer identifiers.

## Scope

1. Extend `@event-commerce/observability` with a small in-memory metric registry and Prometheus text rendering.
2. Add Cloud API and Event Edge metrics modules with:
   - process uptime and resident memory gauges;
   - exact release info;
   - database readiness gauge;
   - HTTP request count, error-class count and duration sum/count using method/status-class labels only.
3. Expose `/metrics` only when `METRICS_ENABLED=true`.
4. Require a non-empty `METRICS_BEARER_TOKEN` whenever metrics are enabled; reject missing/invalid authorization without leaking metric contents.
5. Never place tenant/event/order/device/payment/customer IDs, URLs, arbitrary paths or request values into metric labels.
6. Add permanent tests for rendering, low-cardinality HTTP accounting, disabled metrics, auth failures, exact release identity and DB readiness.
7. Document scrape configuration and provider-neutral alert recommendations.

## Acceptance criteria

- Metrics are disabled by default.
- `METRICS_ENABLED=true` without a sufficiently strong bearer token fails closed during module construction/config validation.
- Authorized `/metrics` returns Prometheus text format and does not include secrets.
- HTTP metrics use bounded labels (`method`, `status_class`) and never raw routes/IDs.
- DB readiness is observable independently for Cloud and Edge.
- Release identity is observable without becoming a high-cardinality counter.
- Existing health/readiness semantics remain unchanged.
- Existing TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not select Prometheus, Grafana, Datadog, CloudWatch or another hosted monitoring vendor.
- Do not add distributed tracing in this slice.
- Do not publish commercial/event/customer/payment values as metrics.
- Do not claim alert delivery has been tested until a real deployment monitoring stack exists.
