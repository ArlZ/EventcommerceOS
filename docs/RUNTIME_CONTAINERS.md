# Runtime containers

The repository builds three deployable runtime images from the root `Dockerfile`:

- `cloud-api` — Cloud API on port 3001;
- `event-edge` — Event Edge on port 3002;
- `control-web` — Control Web on port 3000.

The images are packaging artifacts only. Building or smoke-testing them does not satisfy controlled-pilot deployment or field-evidence gates.

## Build locally

Bind Cloud API and Event Edge images to the exact source commit used to build them:

```bash
RELEASE_COMMIT="$(git rev-parse HEAD)"

docker build --target cloud-api \
  --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" \
  -t event-commerce-cloud-api:"$RELEASE_COMMIT" .

docker build --target event-edge \
  --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" \
  -t event-commerce-event-edge:"$RELEASE_COMMIT" .
```

Control Web browser API routing is a Next.js public build-time value, so the target Cloud URL must be explicit when building the web image:

```bash
docker build --target control-web \
  --build-arg NEXT_PUBLIC_CLOUD_API_URL=https://cloud.example.com \
  -t event-commerce-control-web:"$RELEASE_COMMIT" .
```

Do not pass database passwords, provider credentials, operator secrets or other confidential configuration as Docker build arguments.

Each image declares a runtime health check using Node's built-in HTTP fetch support:

- Cloud API: `GET /health` on port 3001;
- Event Edge: `GET /health` on port 3002;
- Control Web: `GET /api/health` on port 3000.

Cloud and Event Edge health checks inherit the service readiness contract, so a container is not considered healthy merely because its Node process is alive; its configured database must also be reachable.

## Runtime identity

The Cloud API and Event Edge images contain the build SHA as the default `RELEASE_COMMIT` when the build argument is provided. A deployment can still override the environment value deliberately, but `pnpm pilot:preflight` requires both deployed services to report the exact release selected for field validation.

Before a controlled pilot, verify that the SHA used for the image tag, deployment record, evidence manifest and `/health` response all refer to the same candidate.

## Cloud API configuration

At minimum, production deployment must provide the database and security/runtime configuration documented in `infra/.env.example`, including the Cloud PostgreSQL connection and abuse-protection deployment mode.

Run Cloud migrations from the exact image against the target database before serving traffic:

```bash
docker run --rm \
  -e DATABASE_URL="$CLOUD_DATABASE_URL" \
  event-commerce-cloud-api:"$RELEASE_COMMIT" \
  node scripts/migrate.mjs
```

The Cloud runtime image includes the production application, migrations and operational scripts required by the packaged service.

## Event Edge configuration

Event Edge requires its own local PostgreSQL connection and release identity. Its production database must not be pointed at the Cloud database.

Run Edge migrations from the exact image against the Edge database before serving traffic:

```bash
docker run --rm \
  -e DATABASE_URL="$EDGE_DATABASE_URL" \
  event-commerce-event-edge:"$RELEASE_COMMIT" \
  node scripts/migrate.mjs
```

The Edge runtime image includes the production application, migrations and device-management operational script.

## Control Web configuration

Control Web uses Next.js standalone output and runs the generated `server.js` as the non-root `node` user. Because `NEXT_PUBLIC_CLOUD_API_URL` is exposed to browser code, changing it requires rebuilding the web image rather than only changing a runtime environment variable.

## Security and reproducibility

- the Node base image is pinned by SHA-256 digest;
- runtime processes run as the non-root `node` user;
- Cloud API and Event Edge runtime images contain production dependencies rather than the full monorepo development tree;
- Control Web uses Next.js standalone output;
- runtime images declare executable health checks without adding curl or another utility dependency;
- local `.env*`, evidence artifacts, build outputs, Git metadata and dependency directories are excluded from the Docker build context;
- container CI has read-only repository permission and uses an immutable checkout action revision;
- no image registry credentials or deployment credentials are required by the build workflow.

## CI guarantee

The runtime-container workflow builds all three production targets from the candidate, runs Cloud API and Event Edge migrations from the packaged images, boots the images against PostgreSQL, requires Cloud and Edge to report the candidate SHA, waits for readiness, and confirms the running containers are non-root.

This catches packaging failures that application unit/integration tests alone cannot detect. It remains synthetic deployment validation and does not replace representative restore, flood/abuse, supported-device/network, payment-provider, inventory-close or controlled-live-pilot evidence.

Image publication, registry retention/signing and hosting-provider deployment remain separate follow-on steps. The pilot must still use the exact-release preflight and real evidence workflow after deployment.
