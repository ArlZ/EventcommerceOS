# Controlled Pilot Preflight

Use this preflight after deploying an exact release candidate and before beginning the real pilot exercises in `docs/PILOT_RUNBOOK.md`.

A PASS means only that the deployment is internally consistent enough to begin field validation. It does not satisfy or change any pilot evidence gate.

## Required inputs

The Cloud API and Event Edge deployments must each set:

`RELEASE_COMMIT=<40-character lowercase Git SHA>`

The validation workstation needs:

- `PILOT_EVIDENCE_MANIFEST` — path to the initialized pilot evidence JSON;
- `CLOUD_HEALTH_URL` — Cloud `/health` URL;
- `EDGE_HEALTH_URL` — Event Edge `/health` URL;
- `ABUSE_DEPLOYMENT_MODE`;
- `TRUST_PROXY_HOPS`;
- `ABUSE_UPSTREAM_CONFIRMED`.

The evidence manifest must already identify the event, event date, venue, deployment mode and all five named owners. Gates may still be `NOT_RUN` or `FAIL` at this point. Any gate already claiming `PASS` must carry evidence references and named review.

## Run

Initialize the evidence manifest on the exact candidate if it does not exist yet:

```bash
PILOT_EVIDENCE_RELEASE_COMMIT="$(git rev-parse HEAD)" pnpm pilot:evidence:init -- artifacts/pilot/evidence.json
```

Then run:

```bash
PILOT_EVIDENCE_MANIFEST=artifacts/pilot/evidence.json \
CLOUD_HEALTH_URL=https://cloud-pilot.example.com/health \
EDGE_HEALTH_URL=https://edge-pilot.example.com/health \
ABUSE_DEPLOYMENT_MODE=single_instance_pilot \
TRUST_PROXY_HOPS=0 \
ABUSE_UPSTREAM_CONFIRMED=false \
pnpm pilot:preflight
```

The default report is `artifacts/pilot/preflight.json`. Set `PILOT_PREFLIGHT_OUTPUT` to choose another path.

Remote health endpoints must use HTTPS. Plain HTTP is accepted only for local development addresses. Health URLs containing credentials, query parameters or fragments are rejected.

## What PASS proves

The report verifies:

- exact release SHA and Git tree;
- clean tracked checkout;
- matching pilot evidence manifest;
- named pilot ownership;
- valid deployment-mode configuration;
- reachable Cloud API and Event Edge health endpoints;
- correct service identities;
- matching `RELEASE_COMMIT` from both deployments.

The report includes a SHA-256 digest and deliberately does not serialize unrelated environment values.

## What PASS does not prove

Preflight does not replace branch protection, dependency review, representative restore evidence, the deployment flood exercise, supported-device/network testing, offline/restart durability, payment fault testing, inventory reconciliation, controlled pilot close or human go/no-go review.

Continue with `docs/PILOT_RUNBOOK.md`, retain the evidence, and finish with `pnpm pilot:evidence:validate`.
