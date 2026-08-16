# Plan 012 — Render Controlled-Pilot Deployment

## Goal

Remove AWS account setup as the blocker to real-world Pilot 1 validation while preserving the same commerce, payment, inventory, sync and release-safety semantics.

Render is a controlled-pilot hosting path, not a change to the local-first architecture. Event Edge remains venue-local.

## Scope

1. Add a Render Blueprint for Cloud API, Event Control and managed PostgreSQL.
2. Keep Cloud API and Event Control at one instance each while `single_instance_pilot` abuse semantics apply.
3. Use Frankfurt for both services and database so database traffic stays on the Render private network.
4. Block public PostgreSQL ingress.
5. Disable automatic application deployment.
6. Bind application runtime and migration execution to an explicit full release SHA and verify it against Render's deployed Git SHA.
7. Keep M-PESA restricted to sandbox and omit credentials from source control.
8. Add exact-release HTTPS smoke tooling.
9. Add repository regression tests for the Render deployment contract.

## Explicit non-goals

- Moving Event Edge to Cloud.
- Changing order, payment, inventory, sync or reconciliation semantics.
- Enabling live-money M-PESA.
- Claiming field readiness from a successful cloud deploy.
- Removing the AWS deployment path.
- Adding a new runtime dependency to application packages.

## Deployment contract

### Cloud API

- Render web service, Docker runtime.
- Frankfurt.
- Starter instance, exactly one instance.
- `/health` health check.
- PostgreSQL internal connection string injected as `DATABASE_URL`.
- `single_instance_pilot` abuse mode with one trusted Render proxy hop.
- pre-deploy migration command from the exact application image.
- runtime refuses to start when `RELEASE_COMMIT != RENDER_GIT_COMMIT`.

### Event Control

- Render web service, Docker runtime.
- Frankfurt.
- Starter instance, exactly one instance.
- `/api/health` health check.
- runtime refuses to start when `RELEASE_COMMIT != RENDER_GIT_COMMIT`.

### PostgreSQL

- PostgreSQL 16.
- Frankfurt.
- Basic 1 GB compute with 15 GB disk for Pilot 1.
- no public inbound IPs.
- direct internal connection string; no PgBouncer for the first bounded pilot.

## Release sequence

1. Merge this deployment foundation only after normal repository and hardened-container gates pass.
2. Refresh release-evidence issue #24 to the new exact `main` SHA.
3. Create/connect Render workspace and private GitHub repository access.
4. Create resources from `infra/render/pilot/render.yaml`.
5. Configure exact release SHA and canonical HTTPS origins.
6. Deploy the same exact commit to both services with auto-deploy off.
7. Let the Cloud API pre-deploy migration complete.
8. Run `infra/render/pilot/smoke.sh` and retain evidence.
9. Add M-PESA sandbox secrets only when the payment-fault rehearsal begins.
10. Continue the existing Pilot Runbook for Edge, devices, offline/reconnect, provider faults, stock, recovery, abuse, close and controlled live trading.

## Acceptance criteria

- Repository tests fail if Render resources leave Frankfurt, auto-deploy is enabled, service count exceeds one, public database ingress is enabled, PostgreSQL major version drifts, M-PESA base URL leaves sandbox, exact-release guards are removed, or the dynamic Docker runtime target is removed.
- Existing named Docker targets remain buildable under the permanent container workflow.
- Normal CI, Android, dependency SCA, hardened runtime-container validation and secret scan are green on the merged exact `main` SHA.
- No secrets are committed.

## Field correction — Render Docker command parsing

The first real Event Control deployment reached the Render runtime but exited with status 127. The logs showed Render passing the compound Blueprint `dockerCommand` through in a way that caused the quoted command body to be treated as a command name rather than executing `node server.js`.

Correction:

- remove compound `dockerCommand` overrides from both Render web services;
- add Render-only executable startup and migration wrappers to the final Docker image stage;
- let Render use the final image `CMD` directly for service startup;
- keep the exact `RELEASE_COMMIT == RENDER_GIT_COMMIT` fail-closed guard inside both wrappers;
- keep Cloud migrations as a pre-deploy step using one executable path rather than a compound shell command;
- preserve the existing named Cloud API, Event Edge and Control Web runtime stages for permanent CI.

This is a deployment-adapter correction only. It does not change application commerce semantics or weaken the exact-release gate.

## External gates after repository completion

- Render workspace/account access.
- Render GitHub connection to the private repository.
- final Render/custom HTTPS origins.
- M-PESA sandbox credentials and callback registration.
- venue Event Edge and network.
- supported Android devices.
- named release/security review and all field evidence required by issue #24.
