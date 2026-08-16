# Hostinger controlled-pilot deployment

This is the preferred Pilot 1 Cloud deployment path for Event Commerce OS when AWS account onboarding is a blocker.

It deploys only the **Cloud API**, **Event Control Web** and **Cloud PostgreSQL** to one Hostinger VPS. **Event Edge remains venue-local** and Android POS remains local-first. A VPS outage or WAN failure must therefore not become a synchronous bartender checkout dependency.

## Pilot baseline

Provision a Hostinger **KVM 2-class VPS or larger** with at least:

- 2 vCPU;
- 8 GB RAM;
- 100 GB NVMe;
- Ubuntu 24.04 + Docker template;
- Germany as the initial pilot location unless a closer supported VPS location is available at provisioning time.

Re-check current Hostinger locations and capacity at purchase time. Do not treat the location in this document as permanent production architecture.

## Topology

```text
Internet
   |
   | HTTPS :443
   v
Hostinger Traefik / Let's Encrypt
   |----------------------|
   v                      v
Cloud API :3001       Event Control :3000
   |
   | internal Docker network only
   v
PostgreSQL :5432

Venue LAN (separate)
Android POS -> Event Edge -> Cloud API when WAN is available
```

The Compose project does **not** publish ports `3000`, `3001` or `5432` on the VPS. Traefik is the only public application ingress. PostgreSQL is attached only to an internal Docker network.

## 1. Provision and secure the VPS

1. Create the VPS with Hostinger's Ubuntu 24.04 Docker template.
2. Add an SSH public key; prefer key-based SSH over password administration.
3. In the Hostinger VPS firewall allow only:
   - TCP 80 from the internet (certificate/redirect path);
   - TCP 443 from the internet;
   - TCP 22 only from known administrator source IPs where operationally possible.
4. Do **not** open `3000`, `3001`, `5432` or arbitrary Docker ports.
5. Keep Hostinger's automatic VPS backups enabled.

## 2. Deploy Hostinger Traefik

In hPanel:

1. VPS -> Docker Manager -> Catalog;
2. deploy the Hostinger Traefik project;
3. provide the ACME/Let's Encrypt email;
4. confirm the shared Docker network exists:

```bash
docker network inspect traefik-proxy
```

If Hostinger changes the generated network name, set `TRAEFIK_NETWORK` in `.env` to the actual name.

## 3. DNS

Choose two pilot hostnames, for example:

```text
api.pilot.example.com
control.pilot.example.com
```

Create A records for both pointing to the VPS public IP. If Cloudflare is used, keep the records DNS-only until Traefik has successfully issued the initial certificates.

## 4. Put the exact release on the VPS

Use a **read-only GitHub deploy key** for the private repository rather than copying a personal GitHub password/token into shell history.

Clone the repository to a fixed path such as:

```bash
sudo mkdir -p /opt/event-commerce
sudo chown "$USER":"$USER" /opt/event-commerce
git clone git@github.com:ArlZ/EventcommerceOS.git /opt/event-commerce/repo
cd /opt/event-commerce/repo
git checkout <exact-release-sha>
```

Do not deploy from a moving branch tip. The deployment script refuses a checkout whose `HEAD` differs from `RELEASE_COMMIT` or has tracked modifications.

## 5. Configure secrets

```bash
cd /opt/event-commerce/repo/infra/hostinger/pilot
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Put the generated 64-character value into `POSTGRES_PASSWORD`. Set:

- `RELEASE_COMMIT` to the exact full Git SHA;
- `API_DOMAIN`;
- `CONTROL_DOMAIN`;
- `TRAEFIK_NETWORK` if different from `traefik-proxy`.

Leave the M-PESA values blank until sandbox testing begins. This pilot Compose file hard-codes `https://sandbox.safaricom.co.ke`; do not alter it for live money during controlled-pilot preparation.

Never commit `.env` or paste its secrets into GitHub issues/chat.

## 6. Deploy

From the exact clean release checkout:

```bash
cd /opt/event-commerce/repo/infra/hostinger/pilot
./deploy.sh
```

The script fails closed unless:

- `RELEASE_COMMIT` is a full lowercase SHA;
- the checkout exactly matches it;
- tracked files are clean;
- PostgreSQL password format is URL-safe and strong;
- the Traefik network exists;
- Compose validates;
- PostgreSQL becomes healthy;
- application images carry the exact OCI revision label;
- Cloud migrations succeed before application startup;
- both application containers become healthy;
- public HTTPS health endpoints report the exact release SHA, unless smoke was explicitly skipped for bootstrap.

`HOSTINGER_SKIP_HTTPS_SMOKE=1` exists only to bootstrap infrastructure before DNS/TLS is ready. A deployment using that switch is not release evidence.

## 7. Database backups

Create a database-level backup immediately after initial configuration and before/after meaningful pilot exercises:

```bash
./backup.sh
```

The script creates a PostgreSQL custom-format dump, records its SHA-256 and retains seven days locally by default. Configure a daily root/user cron entry, for example:

```text
15 2 * * * /opt/event-commerce/repo/infra/hostinger/pilot/backup.sh >> /var/log/event-commerce-backup.log 2>&1
```

Before field validation also create a Hostinger VPS snapshot/backup recovery point. Local dumps and VPS backups are useful but do not by themselves satisfy the representative recovery gate: at least one representative backup must be copied to a separate secure failure domain and restored with RPO/RTO/fingerprint evidence and named review.

Mechanical isolated restore check:

```bash
./restore-check.sh /opt/event-commerce/backups/<backup>.dump
```

## 8. Smoke and monitoring

Repeat exact-release HTTPS smoke at any time:

```bash
./smoke.sh
```

Operational commands:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail 200 cloud-api
docker compose --env-file .env logs --tail 200 control-web
docker compose --env-file .env logs --tail 200 postgres
```

The Compose project rotates container JSON logs to reduce disk-exhaustion risk. Host-level disk, RAM, CPU, Docker health and backup freshness still require pilot monitoring.

## 9. M-PESA sandbox

When Safaricom sandbox credentials are available, add only the sandbox values to `.env` and redeploy:

```bash
./deploy.sh
```

The callback URL is fixed to:

```text
https://<API_DOMAIN>/payments/providers/mpesa/callback
```

Execute the full delayed/duplicate/timeout/lost-ack/UNKNOWN/reconciliation matrix before any live-money decision.

## 10. Rollback boundary

Application images are tagged by exact Git SHA. To roll back application code:

1. select a previously validated release SHA;
2. check out that exact SHA;
3. set `RELEASE_COMMIT` to it;
4. run `./deploy.sh`.

Database migrations are forward-only and audited. Never attempt an automatic destructive schema rollback. Restore/recovery decisions must follow the pilot recovery runbook and preserve transaction/audit history.

## What this does not prove

A successful Hostinger deployment proves only that the exact software release can run on the pilot Cloud topology. It does **not** prove venue LAN quality, Event Edge power/restart behavior, Android device durability, provider reconciliation, 100-order offline recovery, inventory convergence, abuse resistance on the real topology, representative recovery, Event Close, or controlled live-pilot graduation.
