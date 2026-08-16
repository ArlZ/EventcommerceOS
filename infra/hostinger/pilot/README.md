# Controlled Pilot on Hostinger VPS

This directory is the Hostinger deployment adapter for Event Commerce OS Pilot 1.

It keeps the same application boundary as the existing cloud pilot paths:

- Cloud API runs in the cloud.
- Event Control runs in the cloud.
- PostgreSQL 16 runs privately on the Hostinger VPS.
- Event Edge remains venue-local and is not deployed to Hostinger.
- Android POS continues to use Event Edge over the venue LAN.
- M-PESA stays on Safaricom sandbox until the payment-fault matrix is explicitly started.

The Render and AWS deployment paths remain available. Hostinger is an additional pilot hosting option, not an architecture change.

## Hostinger topology

Use one Hostinger VPS with the Docker template. KVM 2 is the recommended pilot starting size so the VPS has enough headroom to build the Node/Next images while PostgreSQL and the running services remain available.

The Compose project contains:

- `postgres` — PostgreSQL 16.14, private Docker network only, persistent named volume.
- `cloud-migrate` — one-shot migration container from the exact Cloud API release image.
- `cloud-api` — one Cloud API container.
- `control-web` — one Event Control container.

Public HTTPS is handled by Hostinger's Traefik Docker project. Only Cloud API and Event Control join the shared `traefik-proxy` network. PostgreSQL never publishes a host port.

## Files

- `docker-compose.yml` — the Hostinger pilot stack.
- `pilot.env.example` — required variables without real secrets.
- `smoke.sh` — verifies both HTTPS health endpoints and the exact release SHA.
- `.github/workflows/hostinger-pilot-deploy.yml` — manual exact-release deployment workflow.

## One-time Hostinger setup

1. Create a Hostinger VPS using the Docker template.
2. In hPanel, open **VPS → Docker Manager** and deploy Hostinger's Traefik template. Confirm it creates the external `traefik-proxy` Docker network and uses the `letsencrypt` certificate resolver.
3. Point two DNS names to the VPS public IP:
   - Cloud API host, for example `api.<your-domain>`.
   - Event Control host, for example `control.<your-domain>`.
4. Because this repository is private, create an SSH deploy key on the VPS and add the public key to the GitHub repository under **Settings → Deploy keys**. Read access is sufficient.
5. In Hostinger hPanel **API settings**, generate an API key.
6. Find the VPS VM ID from the VPS overview URL or the default `srv<id>.hstgr.cloud` hostname.
7. In this GitHub repository under **Settings → Secrets and variables → Actions**, add:

   Secrets:
   - `HOSTINGER_API_KEY`
   - `HOSTINGER_POSTGRES_PASSWORD`

   Variables:
   - `HOSTINGER_VM_ID`
   - `HOSTINGER_CLOUD_HOST`
   - `HOSTINGER_CONTROL_HOST`

Generate `HOSTINGER_POSTGRES_PASSWORD` with URL-safe characters because the same value is used in the internal PostgreSQL connection URL. A suitable command is:

```bash
openssl rand -hex 32
```

Do not commit any of these values.

## M-PESA sandbox secrets

Leave these GitHub Action secrets unset until the sandbox payment-fault work begins:

- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_BUSINESS_SHORT_CODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`

When enabled, `MPESA_CALLBACK_URL` must be:

```text
https://<HOSTINGER_CLOUD_HOST>/payments/providers/mpesa/callback
```

The Compose file fixes `MPESA_BASE_URL` to Safaricom sandbox.

## Deployment discipline

The Hostinger workflow is intentionally **manual only**. It does not deploy on every push.

To deploy:

1. Merge the reviewed deployment candidate to `main`.
2. Copy the full 40-character `main` commit SHA.
3. In GitHub, open **Actions → Deploy Hostinger Pilot → Run workflow**.
4. Paste the exact SHA into `release_commit`.
5. Run the workflow.

The workflow validates the SHA format, checks out that exact commit, verifies the checkout SHA, and only then calls Hostinger's deployment action. The same SHA is supplied as the Docker build argument, so both application health endpoints report the exact image release.

## Startup ordering

Compose waits for PostgreSQL health first.

`cloud-migrate` then runs the packaged checksum-guarded Cloud migrations from the same exact Cloud API image that will serve traffic. `cloud-api` starts only after migration exits successfully. `control-web` starts only after the Cloud API becomes healthy.

A failed migration therefore prevents the new Cloud API container from being brought into service.

## HTTPS routing

Hostinger's Traefik project is the only public ingress.

The application Compose file creates two routers:

- `${CLOUD_HOST}` → Cloud API port `3001`.
- `${CONTROL_HOST}` → Event Control port `3000`.

Both use the `websecure` entrypoint and the `letsencrypt` certificate resolver.

Do not publish PostgreSQL port `5432` to the VPS host.

## Post-deploy smoke

From a clean checkout of the exact release:

```bash
export RELEASE_COMMIT=<full-40-character-sha>
export CLOUD_ORIGIN=https://<cloud-api-host>
export CONTROL_ORIGIN=https://<event-control-host>
./infra/hostinger/pilot/smoke.sh
```

A PASS proves only that:

- both HTTPS endpoints are reachable;
- both health endpoints report `ok`;
- both report the exact release SHA.

It does not satisfy the venue Event Edge, Android hardware, offline-order, provider-fault, abuse/flood, recovery, inventory, close/reconciliation or live-pilot evidence gates.

## Database and backups

PostgreSQL data is stored in the named Docker volume `cloud-postgres-data` and is not exposed publicly.

Hostinger VPS backups are useful as a host-level recovery layer, but database recovery evidence must still be treated separately. Before any live-money pilot, perform and record the repository's database backup/restore rehearsal against this deployment.

Do not attempt schema rollback by editing or deleting applied migrations. The repository migration ledger is append-only and checksum-guarded; corrections must use a new forward migration.

## What still requires account-level access

Repository preparation cannot create or modify the Hostinger account itself. The external setup that must exist before the first real deployment is:

- Hostinger Docker VPS;
- Traefik project;
- DNS for the two HTTPS hostnames;
- GitHub deploy key installed from the VPS;
- Hostinger API key and VM ID added to GitHub;
- a strong PostgreSQL password added as a GitHub secret.

Once those exist, deployment is a manual GitHub Actions run against one exact reviewed commit.
