# Runtime Images

The repository can build the Cloud API, Event Edge and Control Web as OCI-compatible container images from the same root `Dockerfile`.

These images are deployment artifacts, not proof of a completed pilot deployment. The controlled-pilot evidence requirements in `docs/PILOT_RUNBOOK.md` and `docs/PILOT_EVIDENCE.md` still apply.

## Exact release identity

Always build with a full Git commit SHA:

```bash
RELEASE_COMMIT="$(git rev-parse HEAD)"
```

Cloud API and Event Edge expose the baked value through `/health` as `releaseCommit`. A deployment may override `RELEASE_COMMIT` at runtime only when the operator is deliberately binding the container to another verified source identity. The pilot preflight will reject a mismatch.

## Build Cloud API

```bash
docker build \
  --build-arg APP_FILTER=@event-commerce/cloud-api \
  --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" \
  -t event-commerce/cloud-api:"$RELEASE_COMMIT" \
  .
```

## Build Event Edge

```bash
docker build \
  --build-arg APP_FILTER=@event-commerce/event-edge \
  --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" \
  -t event-commerce/event-edge:"$RELEASE_COMMIT" \
  .
```

## Build Control Web

`NEXT_PUBLIC_CLOUD_API_URL` is compiled into the browser bundle by Next.js and therefore must be supplied at image build time for the target environment.

```bash
docker build \
  --build-arg APP_FILTER=@event-commerce/control-web \
  --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" \
  --build-arg NEXT_PUBLIC_CLOUD_API_URL=https://cloud.example.com \
  -t event-commerce/control-web:"$RELEASE_COMMIT" \
  .
```

Do not pass credentials or provider secrets as Docker build arguments. Runtime secrets belong in the deployment secret store/environment and must not be baked into image layers.

## Database migrations

Run migrations from the exact image that will be deployed. Example for Cloud API:

```bash
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  event-commerce/cloud-api:"$RELEASE_COMMIT" \
  pnpm --filter @event-commerce/cloud-api db:migrate
```

Run the Event Edge migration command against its target database in the same way.

## Runtime expectations

The image starts as the unprivileged `node` user. Production deployments must provide the environment required by the service, including database connectivity and the abuse-protection deployment contract documented in `docs/ABUSE_PROTECTION.md`.

For Cloud API in the single-instance pilot model, the relevant deployment settings include:

```text
NODE_ENV=production
ABUSE_DEPLOYMENT_MODE=single_instance_pilot
ABUSE_UPSTREAM_CONFIRMED=false
TRUST_PROXY_HOPS=0
RELEASE_COMMIT=<exact release SHA>
```

Event Edge must receive its own database, device/authentication and Cloud-forwarder configuration as applicable to the pilot topology.

## CI guarantee

The `runtime-images` CI job builds all three images from the exact candidate. It then runs Cloud API and Event Edge migrations from those images, boots the containers against PostgreSQL, verifies exact-release health, and confirms the application containers are not running as root.

A green image smoke test proves only that the repository can produce internally consistent bootable artifacts. It does not replace representative device/network, payment-provider, restore, flood/abuse, inventory-close or controlled-live-pilot evidence.
