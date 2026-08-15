# Event Commerce OS — Abuse Protection and HTTP Bounds

This document defines the application and deployment controls for Task 010 SEC-005.

The goal is to bound malicious/runaway HTTP work **without making local event commerce depend on Cloud availability** and without silently changing payment truth.

## 1. Cloud application protection

Cloud applies a global abuse guard before operator/session database authentication, followed by a per-policy in-flight concurrency cap before controller business logic.

Every non-`OPTIONS` request consumes a **source-IP bucket**. Where a stable caller exists it also consumes a **caller bucket**:

- Event Edge: SHA-256 fingerprint of Edge ID + bearer credential;
- human operator: SHA-256 fingerprint of the operator bearer;
- provider callback: provider-specific bucket plus source bucket;
- unauthenticated/public requests: source bucket only.

Bearer/session secrets are never retained as bucket keys and never written to reject logs.

Each policy has three independent controls:

- **sustained rate** — continuous token refill in requests/minute;
- **burst** — maximum immediately available tokens, preventing a full minute allowance from arriving at once;
- **max in-flight** — global per-process concurrent work ceiling for that policy, limiting instantaneous resource pressure even across many source IPs.

Default Cloud policies:

| Policy | Requests/minute | Immediate burst | Max in-flight | Intent |
| --- | ---: | ---: | ---: | --- |
| Edge sync/inventory | 1,200 | 120 | 64 | Supports large replay drain; each request already contains at most 100 events |
| Edge payment | 3,000 | 300 | 128 | Supports high event payment throughput, rail checks and reconciliation retries |
| Provider callback | 1,200 | 200 | 128 | Preserves legitimate duplicate/retry bursts while bounding one provider/source |
| Operator read | 600 | 60 | 128 | Command-centre/report polling and operational reads |
| Operator mutation | 120 | 30 | 32 | Human configuration/financial/close actions |
| Public/other | 120 | 30 | 64 | Health/invalid/unauthenticated traffic |

A source and a caller must both remain within the applicable token allowance. This matters because rotating random bearer strings or fake Edge IDs does not bypass the source-IP limiter. The global in-flight ceiling additionally protects the process from distributed instantaneous pressure that source buckets alone would not stop.

The in-memory bucket store is hard-bounded (`ABUSE_MAX_BUCKETS`, default 20,000) and evicts least-recently-touched keys rather than allowing attacker-driven unbounded memory growth.

### 429 behavior

A rate-rejected request returns:

- HTTP `429`;
- `Retry-After`;
- `X-RateLimit-Policy`;
- `X-RateLimit-Limit`;
- `X-RateLimit-Burst`;
- `X-RateLimit-Remaining`.

A concurrency-rejected request also returns HTTP `429`, `Retry-After: 1` and `X-Concurrency-Limit`.

Rate-reject logs are sampled to at most one structured warning per source/policy bucket per minute:

`HTTP_ABUSE_RATE_REJECT`

The log contains only policy, caller type, a truncated SHA-256 source fingerprint and retry delay. Deployment monitoring must also count HTTP `429` responses so concurrency rejects are visible even when they are not individually logged.

## 2. Event Edge LAN protection

Event Edge enforces a separate local token bucket and per-policy in-flight concurrency cap. It does not call Cloud or a shared remote store to make either decision.

Defaults:

| Policy | Requests/minute | Immediate burst | Max in-flight |
| --- | ---: | ---: | ---: |
| POS device sync | 1,800 | 180 | 64 |
| POS device payment | 1,200 | 120 | 192 |
| Other LAN HTTP | 300 | 60 | 64 |

Authenticated POS traffic is dual-limited by source and a SHA-256 device/credential fingerprint. `OPTIONS` is exempt from token consumption and concurrency accounting.

This local limiter protects Event Edge from a runaway/compromised POS while preserving the offline-first rule: an unavailable Cloud limiter can never stop a local sale.

Rate-reject warnings use:

`EDGE_HTTP_ABUSE_RATE_REJECT`

Deployment monitoring must also count Event Edge HTTP `429` responses to surface local concurrency saturation.

## 3. Body and connection bounds

Cloud defaults:

- JSON body: 1 MiB, configurable only between 64 KiB and 2 MiB;
- urlencoded body: 64 KiB, bounded 16–256 KiB;
- inbound request timeout: 30 s;
- header timeout: 10 s;
- keep-alive timeout: 5 s;
- maximum parsed header count: 100.

Event Edge defaults:

- JSON body: 1 MiB, bounded 64 KiB–2 MiB;
- urlencoded body: 64 KiB, bounded 16–256 KiB;
- inbound request timeout: 15 s;
- header timeout: 5 s;
- keep-alive timeout: 5 s;
- maximum parsed header count: 100.

The existing sync/inventory validators also reject machine batches above 100 events.

## 4. Proxy trust and client IP

Cloud does **not** trust `X-Forwarded-For` by default (`TRUST_PROXY_HOPS=0`).

When a reviewed ingress proxy/API gateway is installed, configure the exact number of trusted proxy hops. Do not set a broad trust value merely to make client IPs appear correct; doing so would let an attacker spoof the source limiter key.

## 5. Single-instance pilot vs distributed production

Per-process token buckets and in-flight limits are real application controls, but they are not a distributed global limit across multiple Cloud API replicas.

Production startup therefore requires an explicit `ABUSE_DEPLOYMENT_MODE`:

### `single_instance_pilot`

Use only for a tightly controlled single-Cloud-instance pilot. The application rate/burst/concurrency controls are the active boundary. Local POS/Event Edge operation remains independent if Cloud is unavailable.

### `upstream_distributed`

Use for an internet-exposed multi-instance Cloud deployment. Startup additionally requires:

- `ABUSE_UPSTREAM_CONFIRMED=true`;
- `TRUST_PROXY_HOPS>=1` with the exact trusted ingress topology.

The upstream WAF/API gateway/reverse proxy must enforce source limits **before** load balancing to application replicas. At minimum it must:

- cap sustained request rate and immediate burst by source IP for all Cloud paths;
- maintain a higher provider-callback burst allowance than generic public traffic;
- maintain a high Edge machine allowance consistent with documented batch/replay throughput;
- apply connection/header/body limits at the network edge;
- not cache or log Authorization credentials;
- preserve provider callbacks/retries rather than convert a dropped callback into payment failure;
- emit rate-reject metrics/alerts with source/provider/path dimensions;
- preserve the real client IP only through an explicitly trusted proxy chain.

The deployment evidence pack must record the actual provider/product/configuration used. Setting the confirmation environment variable by itself is not evidence.

## 6. Payment semantics under throttling

HTTP throttling is a transport condition, not payment truth.

- A blocked/timeout Edge -> Cloud initiation remains ambiguous from the Edge/POS point of view and follows the existing `UNKNOWN`/reconciliation rules.
- Event Edge payment throttling is likewise a transport condition; it must not mutate a durable payment attempt into provider failure.
- A delayed provider callback is not automatically a failed payment; provider status reconciliation remains authoritative.
- Do not ask a customer to repeat payment merely because the first network call received `429` or timed out.

## 7. Pilot abuse exercise

Before live money:

1. Capture normal request rate, burst and concurrent request levels during the pre-open durability/payment matrix.
2. Generate a sustained Cloud public/invalid request burst until `429` is observed.
3. Generate an instantaneous burst large enough to prove the burst ceiling engages before a full minute allowance is consumed.
4. Generate concurrent slow sandbox requests to prove the per-policy in-flight cap returns `429` rather than allowing unbounded work.
5. Generate a bounded authenticated operator burst and confirm legitimate lower-rate reads recover after `Retry-After`.
6. In sandbox, generate duplicate provider callbacks below and above the configured burst threshold; prove duplicates still have one business effect and later reconciliation resolves delayed truth.
7. Generate a runaway test-POS request burst against Event Edge; confirm that device/source is throttled while another registered POS can still create/sync orders.
8. During the Cloud flood, disconnect WAN if needed and prove local POS -> Event Edge cash/order flow continues.
9. Retain structured reject logs/metrics, HTTP `429` counts, effective environment and upstream configuration.

An abuse-control test is a failure if it protects Cloud by breaking local event ordering, mutating payment truth, or causing duplicate business effects.

## 8. Configuration reference

Cloud:

- `ABUSE_DEPLOYMENT_MODE`
- `ABUSE_UPSTREAM_CONFIRMED`
- `TRUST_PROXY_HOPS`
- `ABUSE_LIMIT_EDGE_SYNC_PER_MINUTE`
- `ABUSE_BURST_EDGE_SYNC`
- `ABUSE_MAX_IN_FLIGHT_EDGE_SYNC`
- `ABUSE_LIMIT_EDGE_PAYMENT_PER_MINUTE`
- `ABUSE_BURST_EDGE_PAYMENT`
- `ABUSE_MAX_IN_FLIGHT_EDGE_PAYMENT`
- `ABUSE_LIMIT_PROVIDER_CALLBACK_PER_MINUTE`
- `ABUSE_BURST_PROVIDER_CALLBACK`
- `ABUSE_MAX_IN_FLIGHT_PROVIDER_CALLBACK`
- `ABUSE_LIMIT_OPERATOR_READ_PER_MINUTE`
- `ABUSE_BURST_OPERATOR_READ`
- `ABUSE_MAX_IN_FLIGHT_OPERATOR_READ`
- `ABUSE_LIMIT_OPERATOR_MUTATION_PER_MINUTE`
- `ABUSE_BURST_OPERATOR_MUTATION`
- `ABUSE_MAX_IN_FLIGHT_OPERATOR_MUTATION`
- `ABUSE_LIMIT_PUBLIC_PER_MINUTE`
- `ABUSE_BURST_PUBLIC`
- `ABUSE_MAX_IN_FLIGHT_PUBLIC`
- `ABUSE_MAX_BUCKETS`
- `HTTP_JSON_BODY_LIMIT_BYTES`
- `HTTP_URLENCODED_BODY_LIMIT_BYTES`
- `HTTP_REQUEST_TIMEOUT_MS`
- `HTTP_HEADERS_TIMEOUT_MS`
- `HTTP_KEEP_ALIVE_TIMEOUT_MS`
- `HTTP_MAX_HEADERS_COUNT`

Event Edge:

- `EDGE_ABUSE_LIMIT_DEVICE_SYNC_PER_MINUTE`
- `EDGE_ABUSE_BURST_DEVICE_SYNC`
- `EDGE_ABUSE_MAX_IN_FLIGHT_DEVICE_SYNC`
- `EDGE_ABUSE_LIMIT_DEVICE_PAYMENT_PER_MINUTE`
- `EDGE_ABUSE_BURST_DEVICE_PAYMENT`
- `EDGE_ABUSE_MAX_IN_FLIGHT_DEVICE_PAYMENT`
- `EDGE_ABUSE_LIMIT_LOCAL_OTHER_PER_MINUTE`
- `EDGE_ABUSE_BURST_LOCAL_OTHER`
- `EDGE_ABUSE_MAX_IN_FLIGHT_LOCAL_OTHER`
- `EDGE_ABUSE_MAX_BUCKETS`
- `EDGE_HTTP_JSON_BODY_LIMIT_BYTES`
- `EDGE_HTTP_URLENCODED_BODY_LIMIT_BYTES`
- `EDGE_HTTP_REQUEST_TIMEOUT_MS`
- `EDGE_HTTP_HEADERS_TIMEOUT_MS`
- `EDGE_HTTP_KEEP_ALIVE_TIMEOUT_MS`
- `EDGE_HTTP_MAX_HEADERS_COUNT`
