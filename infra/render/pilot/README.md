# Controlled Pilot on Render

This directory is the low-friction Pilot 1 deployment path for Event Commerce OS.

It does not replace the AWS Cape Town architecture in `infra/aws/pilot/`. AWS remains a valid longer-term production path. Render is being used to remove cloud-account setup as the blocker to field validation.

## What this deploys

- Cloud API as one paid Render web-service instance.
- Event Control as one paid Render web-service instance.
- PostgreSQL 16 on a paid Render database instance.
- All resources in Frankfurt.
- Database access from Render services over Render's internal connection string.
- No public database ingress (`ipAllowList: []`).
- Automatic deploys disabled.
- Exact deployed Git SHA checked at service start and before database migrations.
- M-PESA base URL fixed to Safaricom sandbox. Provider credentials are intentionally not present in the Blueprint.

Event Edge is **not** deployed to Render. It remains on the venue LAN with its own PostgreSQL instance so WAN/Cloud failure cannot become a synchronous checkout dependency.

## Files

- `render.yaml` — Render Blueprint for the two web services and PostgreSQL.
- `pilot.env.example` — non-secret helper values for deployment/smoke work.
- `smoke.sh` — verifies HTTPS health and exact release identity after deployment.

## Release discipline

The controlled pilot deploys one exact, reviewed `main` commit.

The Blueprint uses `autoDeployTrigger: "off"`. Do not enable automatic deployments for Pilot 1. After the resources exist, deploy a specific commit from the Render dashboard and keep the same full 40-character SHA in `RELEASE_COMMIT` for both web services.

Render exposes the actual deployed Git SHA as `RENDER_GIT_COMMIT`. Both runtime commands, plus the Cloud API migration command, compare it with `RELEASE_COMMIT` and fail before serving traffic if they differ.

## Initial Render setup

1. Create or sign in to a Render workspace.
2. Connect the GitHub account that can read the private `ArlZ/EventcommerceOS` repository.
3. Create a new Blueprint from this repository.
4. Set the Blueprint path to `infra/render/pilot/render.yaml`.
5. Keep the region and instance choices from the Blueprint for Pilot 1.
6. Use the current exact controlled-pilot candidate from release-evidence issue #24 as `RELEASE_COMMIT` in both services.
7. Set `NEXT_PUBLIC_CLOUD_API_URL` in both services to the final canonical HTTPS Cloud API origin.
8. Set `CONTROL_WEB_ORIGIN` on the Cloud API to the final canonical HTTPS Event Control origin.
9. Deploy the same exact commit to both services.

The expected default service names are:

- `eventcommerceos-arlz-pilot-api`
- `eventcommerceos-arlz-pilot-control`

Render assigns each web service an HTTPS `onrender.com` address. A custom domain is optional for Pilot 1. If the actual assigned origins differ from the values entered during first setup, update `NEXT_PUBLIC_CLOUD_API_URL` and `CONTROL_WEB_ORIGIN`, then rebuild/redeploy the same exact commit before testing.

`NEXT_PUBLIC_CLOUD_API_URL` is deliberately a build-time value. Changing it requires rebuilding Event Control.

## Database behavior

The Cloud API receives `DATABASE_URL` directly from the Render Postgres resource using its internal connection string. The database is pinned to PostgreSQL 16 to match the repository's tested local and CI database major version.

The Cloud API runs `node scripts/migrate.mjs` as its Render pre-deploy command. The migration process therefore runs from the same exact release image before the new application version is allowed to serve traffic.

The database has no public inbound IP allow-list. Do not open public database access for convenience during the pilot. Use Render-supported internal access and controlled backup/restore procedures instead.

## M-PESA sandbox

Do not add M-PESA production credentials to Pilot 1.

When the Cloud deployment is healthy and we are ready for the payment-fault matrix, add these only to the Cloud API service in Render's secret environment settings:

- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_BUSINESS_SHORT_CODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`

`MPESA_CALLBACK_URL` must be the public Cloud API origin plus:

`/payments/providers/mpesa/callback`

The Blueprint fixes `MPESA_BASE_URL` to `https://sandbox.safaricom.co.ke`.

## Post-deploy smoke

From a clean checkout of the exact release:

```bash
export RELEASE_COMMIT=<full-40-character-sha>
export CLOUD_ORIGIN=https://<cloud-api-host>
export CONTROL_ORIGIN=https://<event-control-host>
./infra/render/pilot/smoke.sh
```

A PASS proves only:

- both HTTPS endpoints are reachable;
- both health endpoints report `ok`;
- both report the exact release SHA.

It does **not** satisfy Event Edge, physical device, offline-order, provider-fault, abuse/flood, recovery, inventory, close/reconciliation or live-pilot evidence gates.

## Rollback and failed deploys

Render supports selecting a specific Git commit for deployment. During Pilot 1, never solve a failed deployment by enabling automatic deployment of latest `main`.

Database migrations are forward-safe and checksum-guarded. Do not blindly roll the database schema backwards. If a release after migration is unhealthy, stop public testing and either redeploy a known schema-compatible application commit or create a corrected forward release.

## What remains external

Repository preparation ends here. A real Render deployment still requires:

- a Render account/workspace;
- GitHub access granted to Render for the private repository;
- the two final HTTPS service origins (Render-provided domains are acceptable);
- later, M-PESA sandbox credentials;
- venue Event Edge hardware/network and Android devices for field validation.

No production/live-money pilot is approved merely because the Render services deploy successfully.
