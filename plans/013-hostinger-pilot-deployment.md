# Plan 013 — Hostinger controlled-pilot deployment

## Goal

Make the exact validated Event Commerce OS release deployable to a Hostinger VPS for Pilot 1 without changing order, payment, inventory, sync, reconciliation or POS business semantics.

AWS and Render remain retained deployment options. Hostinger is the immediate Pilot 1 Cloud path because it removes hyperscaler account onboarding as a blocker while preserving our existing Docker runtime model.

## Architecture decision

Use one Hostinger KVM 2-class VPS or larger for:

- Traefik HTTPS ingress managed through Hostinger Docker Manager;
- Cloud API container;
- Event Control Web container;
- private PostgreSQL container and persistent volume.

Keep Event Edge and its PostgreSQL at the venue. Keep Android POS local-first. Cloud availability must not enter the synchronous sale path.

## Safety constraints

1. Deploy an exact full Git SHA from a clean checkout.
2. Build production images from the existing hardened Dockerfile and verify OCI revision labels.
3. Do not publish PostgreSQL, Cloud API or Event Control container ports directly on the VPS.
4. Use Traefik/HTTPS as the only public application ingress.
5. Keep PostgreSQL on an internal Docker network.
6. Preserve read-only root filesystem, dropped Linux capabilities and `no-new-privileges` for application containers.
7. Keep `single_instance_pilot` abuse semantics and one Cloud API instance for Pilot 1.
8. Hard-code M-PESA to Safaricom sandbox in this deployment bundle.
9. Run migrations before starting the new application release.
10. Retain exact-release HTTPS smoke evidence.
11. Produce database dumps with SHA-256 and prove isolated mechanical restore; do not claim representative recovery until separate-failure-domain/RPO/RTO/business-fingerprint evidence exists.
12. No production/live-money claim follows from a successful VPS deployment alone.

## Repository deliverables

- `infra/hostinger/pilot/docker-compose.yml`
- `infra/hostinger/pilot/.env.example`
- `infra/hostinger/pilot/deploy.sh`
- `infra/hostinger/pilot/smoke.sh`
- `infra/hostinger/pilot/backup.sh`
- `infra/hostinger/pilot/restore-check.sh`
- `infra/hostinger/pilot/README.md`
- repository regression tests for Hostinger pilot safety invariants.

## External deployment sequence

1. Provision Hostinger VPS with Docker template and secure SSH/firewall.
2. Deploy Hostinger Traefik and confirm shared proxy network.
3. Point API and Event Control DNS A records to the VPS.
4. Install a read-only GitHub deploy key and clone the private repository.
5. Check out the exact pilot release SHA.
6. Create `.env` with a generated URL-safe PostgreSQL password and no live payment secrets.
7. Run `deploy.sh`.
8. Retain exact-release HTTPS smoke evidence.
9. Create/hash a database backup and run isolated restore check.
10. Load M-PESA sandbox credentials and run provider-fault tests.
11. Continue the venue Event Edge/POS/offline/inventory/close/recovery rehearsal from `docs/PILOT_RUNBOOK.md`.

## Completion boundary

Repository work is complete when CI, Android/SCA, runtime-container and secret-history gates are green on the exact post-merge `main` candidate. Real Hostinger provisioning, DNS/TLS, payment sandbox, venue hardware and field exercises remain external evidence gates under issue #24.
