# Runtime monitoring probe

`pnpm monitor:runtime` is a dependency-free external health probe for the three deployed Event Commerce OS services. It is designed to be scheduled by a monitoring host, cron runner, uptime platform or Prometheus textfile collector without coupling the application to a specific monitoring vendor.

The probe is synthetic monitoring. It does not replace controlled-pilot field evidence or prove that alert delivery/paging infrastructure is configured.

## Configuration

Provide the exact release selected for the deployment:

```text
RUNTIME_MONITOR_EXPECTED_RELEASE=<40-character lowercase Git SHA>
```

Provide the three health endpoints:

```text
RUNTIME_MONITOR_CLOUD_URL=https://cloud.example.com/health
RUNTIME_MONITOR_EDGE_URL=https://edge.example.com/health
RUNTIME_MONITOR_CONTROL_URL=https://control.example.com/api/health
```

Remote targets must use HTTPS. Plain HTTP is accepted only for localhost development and CI targets.

Health URLs containing embedded credentials, query parameters or fragments are rejected so secrets cannot accidentally enter monitor configuration/reporting paths.

The default per-request timeout is 5 seconds. It may be bounded between 1 and 15 seconds:

```text
RUNTIME_MONITOR_TIMEOUT_MS=5000
```

## Run as a blocking health check

```bash
pnpm monitor:runtime
```

The default JSON report contains only:

- expected release SHA;
- overall PASS/BLOCKED state;
- service name;
- up/down result;
- latency in milliseconds;
- backend release-match result;
- a fixed low-cardinality failure reason such as `TIMEOUT`, `FETCH_FAILED`, `HTTP_503` or `RELEASE_MISMATCH`.

The report does not retain endpoint URLs, response bodies or raw transport/provider error messages.

Exit codes:

- `0` — all three services passed;
- `1` — one or more service probes were blocked;
- `2` — monitor configuration itself is invalid.

Cloud API and Event Edge `/health` are DB-backed readiness checks, so their probe status covers service process + database reachability. Their reported release must also equal `RUNTIME_MONITOR_EXPECTED_RELEASE`. Control Web identity/status is checked, but its current health contract does not report a baked release SHA.

## Prometheus output

```bash
pnpm monitor:runtime -- --prometheus
```

The output uses only the bounded `service` label and exposes:

```text
event_commerce_runtime_probe_up{service="cloud-api"}
event_commerce_runtime_probe_duration_seconds{service="cloud-api"}
event_commerce_runtime_release_match{service="cloud-api"}
```

No event, tenant, order, device, payment, customer, URL or failure-message values are used as metric labels.

A Prometheus textfile collector can run the command on a schedule and atomically replace its `.prom` file only after a successful command execution. Other monitoring systems can use the JSON mode and the process exit code.

## Recommended alert contract

These are provider-neutral thresholds to configure in the chosen deployment monitoring platform; they are not evidence that a pager has already been configured or tested.

### Page immediately

- `event_commerce_runtime_probe_up == 0` for Cloud API or Event Edge on two consecutive checks during an active event;
- `event_commerce_runtime_release_match == 0` at any time after a deployment is declared complete;
- all three services unavailable from the monitoring location.

### High-priority warning

- Control Web unavailable for two consecutive checks while Cloud API remains healthy;
- Cloud API or Event Edge probe latency above 2 seconds for three consecutive checks;
- repeated intermittent failures within a 15-minute window even if individual probes recover.

### Pilot cadence

For a controlled live event, run the probe at least once per minute from a monitoring host outside the application containers. Keep the monitoring host clock synchronized and retain the selected platform's alert/event history with the pilot evidence if it is used during the field exercise.

For non-event development environments, a less frequent cadence is sufficient.

## Release workflow

After deploying a candidate:

1. confirm each image/deployment record refers to the intended Git SHA;
2. run `pnpm pilot:preflight` to verify the controlled-pilot release and manifest contract;
3. run `pnpm monitor:runtime` from the intended monitoring location;
4. configure the chosen monitor to schedule the same probe/output contract;
5. test real alert delivery separately before relying on paging during a live pilot.

A green synthetic probe is necessary operational feedback, but it does not satisfy supported-device/network, payment-provider, recovery, flood/abuse, inventory-close or human go/no-go evidence gates.
