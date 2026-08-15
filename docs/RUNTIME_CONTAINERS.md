# Runtime containers

The repository builds three deployable runtime images from the root `Dockerfile`:

- `cloud-api` — Cloud API on port 3001;
- `event-edge` — Event Edge on port 3002;
- `control-web` — Control Web on port 3000.

The images are packaging artifacts only. Building them does not satisfy controlled-pilot deployment or field-evidence gates.

## Build locally

```bash
docker build --target cloud-api -t event-commerce-cloud-api:local .
docker build --target event-edge -t event-commerce-event-edge:local .
docker build --target control-web -t event-commerce-control-web:local .
```

CI runs these same target builds on relevant pull requests.

Each image also declares a runtime health check using Node's built-in HTTP fetch support:

- Cloud API: `GET /health` on port 3001;
- Event Edge: `GET /health` on port 3002;
- Control Web: `GET /api/health` on port 3000.

Cloud and Event Edge health checks inherit the service readiness contract, so once database-backed readiness is present in the integrated release, a container is not considered healthy merely because its Node process is alive.

## Runtime identity

For a controlled pilot, deploy Cloud API and Event Edge with the exact release commit:

```text
RELEASE_COMMIT=<full lowercase 40-character Git SHA>
```

`pnpm pilot:preflight` checks that both deployed services report that exact release from `/health` before field exercises begin.

Do not bake `RELEASE_COMMIT` or environment-specific secrets into the image. Supply them at deployment time.

## Cloud API configuration

At minimum, production deployment must provide the database and security/runtime configuration documented in `infra/.env.example`, including the Cloud PostgreSQL connection, release identity and abuse-protection deployment mode.

Run Cloud migrations against the target database before serving traffic:

```bash
node scripts/migrate.mjs
```

The Cloud runtime image includes the production application, migrations and operational scripts required by the packaged service.

## Event Edge configuration

Event Edge requires its own local PostgreSQL connection and release identity. Its database must not be pointed at the Cloud database in production.

Run Edge migrations against the target local database before serving traffic:

```bash
node scripts/migrate.mjs
```

The Edge runtime image includes the production application, migrations and device-management operational script.

## Control Web configuration

Control Web is built with Next.js standalone output. Runtime configuration should point browser/server API calls at the deployed Cloud API according to the application's existing environment contract.

The image runs the generated standalone `server.js` as the non-root `node` user.

## Security and reproducibility

- the Node base image is pinned by SHA-256 digest;
- runtime processes run as the non-root `node` user;
- runtime images declare executable health checks without adding curl or another utility dependency;
- local `.env*`, evidence artifacts, build outputs, Git metadata and dependency directories are excluded from the Docker build context;
- container CI has read-only repository permission and uses an immutable checkout action revision;
- no image registry credentials or deployment credentials are required by the build workflow.

Image publication, registry retention/signing and hosting-provider deployment are deliberately separate follow-on steps. The pilot must still use the exact-release preflight and real evidence workflow after deployment.
