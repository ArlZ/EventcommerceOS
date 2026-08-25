# Controlled abuse/flood field evidence

This procedure turns the qualitative pilot exercise in `docs/ABUSE_PROTECTION.md` into retained, machine-verifiable evidence.

It is for Event Commerce OS infrastructure that the operator owns or is explicitly authorised to test. The probe refuses a `production` environment, remote plaintext HTTP, more than 2,000 requests per scenario, or more than 128 concurrent requests. It never emits `liveMoneyApproved: true`.

## Safety boundary

The probe config must set:

- `environment` to `local`, `sandbox` or `controlled-pilot`;
- `targetOwnershipAcknowledged: true`;
- the exact release SHA under test.

Do not put bearer credentials in the JSON config. Use `headersFromEnv`, which maps HTTP header names to environment-variable names. The report never serialises those values, response bodies, request bodies, URL query strings or URL fragments.

Request bodies, when needed for a registered test POS or sandbox callback, should be stored in a local test fixture and referenced with `bodyFile`. Do not retain customer phones, access tokens or live payment data in the shared evidence pack.

## Probe command

```powershell
pnpm pilot:abuse:probe -- `
  "artifacts\pilot\abuse\cloud-public-config.json" `
  "artifacts\pilot\abuse\cloud-public.json"
```

Example public-rate config:

```json
{
  "schemaVersion": 1,
  "releaseCommit": "0123456789abcdef0123456789abcdef01234567",
  "scenarioId": "cloud-public-rate",
  "targetRole": "CLOUD_PUBLIC",
  "environment": "controlled-pilot",
  "targetOwnershipAcknowledged": true,
  "url": "https://api.example.test/not-found",
  "method": "GET",
  "totalRequests": 60,
  "concurrency": 10,
  "requestTimeoutMs": 5000,
  "recovery": true
}
```

The report records only bounded metadata: status-code counts, `429` count, relevant rate/concurrency headers, timestamps, transport-error count and the post-`Retry-After` recovery result.

## Required field observations

Run all scenarios against the same exact release.

### 1. Cloud public burst

Use `targetRole: CLOUD_PUBLIC`. Generate enough controlled traffic to exhaust the public immediate burst. A valid observation must show:

- at least one `429`;
- `X-RateLimit-Policy: PUBLIC`;
- a successful 2xx recovery request after the observed retry delay.

### 2. Cloud concurrency ceiling

Use `targetRole: CLOUD_CONCURRENCY` against a reviewed endpoint where concurrent requests remain in flight long enough to engage the configured application/auth concurrency boundary.

A valid observation must show a `429` and either `X-Concurrency-Limit` or `X-Auth-Concurrency-Limit`, followed by recovery. Do not create an unbounded slow-request test; the probe itself remains capped at 128 workers and 30-second request timeouts.

### 3. Authenticated operator read burst

Use `targetRole: CLOUD_OPERATOR_READ`, a read-only operator endpoint and a controlled operator session supplied through `headersFromEnv`.

A valid observation must show `OPERATOR_READ` throttling and successful recovery. Do not use a financial mutation endpoint to create load merely to test the limiter.

### 4. Runaway Event Edge device

Use `targetRole: EDGE_DEVICE_SYNC` with one registered test POS identity. Run the bounded burst until that device/source receives `429` with `DEVICE_SYNC` policy metadata.

### 5. Healthy peer POS during the runaway burst and Cloud flood

At the same time, run a low-rate `EDGE_DEVICE_SYNC` probe from a second registered test POS. This probe must successfully submit legitimate test sync work and receive no `429` while:

- the runaway-device interval is active; and
- the Cloud public-flood interval is active.

The verifier checks those timestamp overlaps. This proves that a noisy POS and a stressed Cloud do not make healthy venue-local Event Edge ordering unavailable.

### 6. Provider callback burst

In Daraja sandbox only, use `targetRole: PROVIDER_CALLBACK` with duplicate sandbox callback identities. A valid observation must show the provider-callback limiter engaging and later recovering.

HTTP evidence alone is not payment truth. The final verifier additionally requires the independent M-PESA fault-matrix report for the same release/event to be PASS. This prevents a green rate-limit test from hiding duplicate payment effects or false success/decline transitions.

## Evidence manifest

```json
{
  "schemaVersion": 1,
  "releaseCommit": "0123456789abcdef0123456789abcdef01234567",
  "eventId": "controlled-event-id",
  "cloudPublicBurst": "cloud-public.json",
  "cloudConcurrency": "cloud-concurrency.json",
  "operatorReadBurst": "operator-read.json",
  "edgeRunaway": "edge-runaway.json",
  "edgeHealthyPeer": "edge-healthy-peer.json",
  "providerCallbackBurst": "provider-callback.json",
  "paymentFaultMatrixReport": "mpesa-fault-matrix-evidence.json"
}
```

All paths resolve relative to the manifest.

Verify:

```powershell
pnpm pilot:abuse:verify -- `
  "artifacts\pilot\abuse\manifest.json" `
  "artifacts\pilot\abuse\abuse-field-evidence.json"
```

A full PASS requires every HTTP observation plus the independent payment fault-matrix report to match the exact release/event and pass its own payment-certainty checks. The resulting report still contains `liveMoneyApproved: false`; it is one release gate, not a release authorization.

## Failure handling

Preserve the failed evidence and investigate if:

- the limiter never emits `429` under the intended bounded load;
- a healthy peer POS is throttled by another POS;
- Event Edge healthy-peer traffic stops during the Cloud flood;
- a limiter does not recover after its retry window;
- exact release identity differs between observations;
- provider callback throttling creates duplicate financial effects;
- a timeout/`429` is interpreted as payment success or decline.

Never raise limits, wipe queues, delete reconciliation rows or repeat customer payment merely to turn this gate green.
