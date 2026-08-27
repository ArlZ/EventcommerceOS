# Controlled-pilot final release review

This command is the final machine-verifiable aggregation step before the named human go/no-go decision.

It combines:

- the exact Git release checkout;
- the pilot evidence manifest;
- all retained PASS evidence files and their reviewed SHA-256 digests;
- every required gate and named reviewer;
- deployment-mode/trust-proxy configuration;
- live Cloud API, Event Edge and Control Web health/release identity.

It does **not** approve live money. A READY result means the machine-verifiable prerequisites are intact and ready for the named human go/no-go review.

## Prerequisites

Complete the real field exercises, retain the evidence beneath the pilot manifest directory, record named reviews, and make sure:

```bash
pnpm pilot:evidence:validate -- artifacts/pilot/evidence.json
```

passes on the exact candidate release.

Then configure the runtime probes:

```bash
export PILOT_EVIDENCE_MANIFEST=artifacts/pilot/evidence.json
export PILOT_PREFLIGHT_RELEASE_COMMIT=<40-character-release-sha>
export ABUSE_DEPLOYMENT_MODE=single_instance_pilot
export ABUSE_UPSTREAM_CONFIRMED=false
export TRUST_PROXY_HOPS=0
export CLOUD_HEALTH_URL=https://api-event.nairobuy.com/health
export EDGE_HEALTH_URL=<venue-event-edge-health-url>
export CONTROL_HEALTH_URL=https://event.nairobuy.com/health
```

For an upstream-distributed deployment, use the reviewed deployment values required by `docs/PILOT_RUNBOOK.md` instead of the single-instance example.

## Run

```bash
pnpm pilot:release:review
```

Optional output path:

```bash
export PILOT_RELEASE_REVIEW_OUTPUT=artifacts/pilot/release-review.json
```

## READY requires all three layers

1. **All gates:** the schema-v2 pilot manifest passes its full validation, including every required gate at PASS, named reviewer/time, representative recovery and zero blocking dependency findings.
2. **Evidence bytes:** every PASS evidence file still exists under the manifest root and hashes to exactly the digest reviewed.
3. **Exact runtime:** the checkout is clean and exact, the deployment security contract is valid, and Cloud API, Event Edge and Control Web all report healthy on the same exact release SHA.

If any one layer fails, the report is `BLOCKED` and the command exits non-zero.

## Human decision remains mandatory

A successful report uses:

```text
status=READY_FOR_HUMAN_GO_NO_GO
candidateReadyForHumanGoNoGo=true
liveMoneyApproved=false
```

The named operational, finance, inventory, incident and security owners still make the actual go/no-go decision. Do not turn `liveMoneyApproved` into true inside this command, and do not treat READY as authorization to load production M-PESA credentials.

After the human decision, retain the release-review JSON with the rest of the exact-release evidence pack and record the decision in the authoritative release issue.
