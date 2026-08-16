# Reliability — fail-closed production endpoint configuration

Status: **implemented; awaiting exact-head CI**
Base: `main` at `3db6166ba7bbd5ec473f2a16fdbc9c8183591cf7`

## Objective

Prevent production Cloud API and Control Web artifacts from silently inheriting localhost or structurally ambiguous browser/API origins.

## Scope

1. Require explicit `CONTROL_WEB_ORIGIN` when Cloud API runs with `NODE_ENV=production`.
2. Validate the production Control Web origin as one canonical HTTPS origin with no credentials, path, query or fragment.
3. Preserve the localhost fallback for non-production development/tests.
4. Require an explicit canonical HTTPS `NEXT_PUBLIC_CLOUD_API_URL` for production container builds.
5. Pass explicit synthetic HTTPS origins in the runtime-container smoke so production startup/build semantics are exercised rather than bypassed.
6. Document the non-secret endpoint configuration in `infra/.env.example`.
7. Add unit coverage for valid and invalid Cloud CORS-origin configuration.
8. Add negative container-build assertions proving missing, plaintext and path-bearing browser API origins are rejected before a production artifact can be built.

## Acceptance criteria

- production Cloud startup fails before listening if `CONTROL_WEB_ORIGIN` is absent;
- production Cloud rejects plaintext HTTP, credentials, path/query/fragment and malformed origins;
- a canonical HTTPS origin, including an explicit non-default port, is accepted;
- non-production retains `http://localhost:3000` when no origin is configured;
- Docker production builds fail when `NEXT_PUBLIC_CLOUD_API_URL` is absent, plaintext, contains a path/query/fragment/credentials or is not canonical;
- runtime-container CI explicitly proves representative missing/plaintext/path-bearing build origins are rejected;
- runtime-container CI supplies explicit HTTPS Cloud/Web origins for the valid candidate and remains green;
- existing security headers, Trivy image SCA, exact release identity, migrations, readiness and non-root checks remain intact;
- permanent CI and full-history secret scanning remain green.

## Implementation notes

- Cloud API resolves CORS through `controlWebOrigin()` before creating/listening on the Nest application.
- Production `CONTROL_WEB_ORIGIN` must use HTTPS and cannot contain credentials, query, fragment or a non-root path. URL parsing normalizes it to the actual origin used by CORS.
- Non-production retains the current localhost development default.
- The Docker build stage has no `NEXT_PUBLIC_CLOUD_API_URL` default. It validates the supplied value before dependency installation/build work and only accepts an exact canonical HTTPS origin.
- Because the shared build stage also builds Control Web for backend image targets, Cloud API, Event Edge and Control Web image builds all supply the explicit synthetic HTTPS API origin in CI.
- Cloud API packaged-runtime boot now supplies an explicit synthetic HTTPS Control Web origin, exercising the production startup contract.
- No real deployment hostname is committed; these endpoint values are intentionally non-secret deployment configuration.

## Non-goals

- Do not choose the real production hostnames in source control.
- Do not add HSTS before the public TLS/ingress boundary is selected and reviewed.
- Do not widen CORS to multiple origins or wildcards.
- Do not change operator authentication/session architecture.
