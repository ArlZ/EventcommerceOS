# Deployment — reproducible runtime containers

Status: **in progress**
Original base: `main` at `e96b44cfeec9a30e4dbf960ff84fe6e33a7168b5`
Pinned-CI base: `main` at `bcad290f556b2c250d2f11252ec8abfc126bbf0c`
Readiness-integration revalidation base: `main` at `0b9296333d84699c774b82fd6efb7b0bdd856ec1`

## Objective

Turn the already-tested Cloud API, Event Edge and Control Web applications into reproducible deployable container images, and make container construction a permanent pull-request gate.

## Scope

1. Add a multi-stage root Dockerfile with separate `cloud-api`, `event-edge` and `control-web` runtime targets.
2. Pin the Node 22 Debian slim base image by digest rather than relying on a moving image tag.
3. Build workspace dependencies before packaging Cloud API and Event Edge production deployments.
4. Use Next.js standalone output for Control Web, including static assets and monorepo output tracing.
5. Run runtime images as the non-root `node` user.
6. Add `.dockerignore` to keep local build artifacts, secrets and evidence out of Docker build contexts.
7. Add a pinned GitHub Actions workflow that builds all three image targets on relevant pull requests.
8. Do not publish images yet; this slice proves reproducible packaging only.

## Acceptance criteria

- `docker build --target cloud-api .` succeeds from a clean checkout.
- `docker build --target event-edge .` succeeds from a clean checkout.
- `docker build --target control-web .` succeeds from a clean checkout.
- Runtime stages contain production application outputs and required runtime dependencies, not repository secrets or local evidence artifacts.
- Each runtime runs as non-root `node`.
- Node base image is digest pinned.
- Container-build workflow uses only immutable GitHub Action references and read-only repository permissions.
- Existing permanent TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not push images to a registry in this slice.
- Do not select a production hosting provider.
- Do not embed environment secrets or release-specific configuration in images.
- Do not claim successful image construction is pilot deployment evidence.
