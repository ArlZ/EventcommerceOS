# Reliability — reproducible runtime images

Status: **in progress**
Base: `main` at `bae5eb9c549282ccbf571bb9d782d131d274a155`

## Objective

Make the Cloud API, Event Edge and Control Web deployable from reproducible OCI images built from the repository, and make image build/boot/health validation a permanent CI gate.

## Scope

1. Add a root multi-stage Dockerfile that can build any of the three Node services from the pinned pnpm lockfile.
2. Bake the exact source commit into the image as the default `RELEASE_COMMIT` while still allowing deployment-time override.
3. Run application processes as the unprivileged `node` user.
4. Add a minimal `.dockerignore` so credentials, Git metadata, local artifacts and developer state are not copied into build context.
5. Add a CI `runtime-images` job that builds, migrates, boots and health-checks the runtime images.
6. Document exact-image build and pilot deployment expectations.

## Acceptance criteria

- Each service image builds from a clean checkout with `pnpm install --frozen-lockfile`.
- Cloud API and Event Edge images start successfully as non-root containers.
- Image-executed migrations succeed against a clean PostgreSQL database.
- `/health` reports the expected service and exact `RELEASE_COMMIT` baked from the build SHA.
- CI fails if either runtime image cannot build, migrate, boot or identify the exact release.
- Control Web image builds with `NEXT_PUBLIC_CLOUD_API_URL` explicitly supplied at image build time.
- No secrets are baked into image layers by the Dockerfile or CI job.
- Existing TypeScript, Android and SCA gates remain green.

## Non-goals

- Do not claim registry publication or deployment that has not actually occurred.
- Do not embed production database URLs, provider credentials or operator secrets.
- Do not treat container smoke validation as representative hardware/network/pilot evidence.
- Do not introduce Kubernetes or a cloud-vendor-specific deployment stack before the pilot hosting target is chosen.
