# Reliability — Control Web exact release identity

Status: **in progress**
Base: `main` at `ae43f76edc1d051d7e284464aed55d56f99db1e8`

## Objective

Close the remaining runtime release-identity gap by requiring Control Web to report and be monitored against the same exact Git commit as Cloud API and Event Edge.

## Scope

1. Include configured `RELEASE_COMMIT` in the Control Web `/api/health` contract.
2. Bake the candidate SHA into the Control Web production container runtime environment.
3. Make the runtime-container smoke require exact release identity for all three deployable services.
4. Make the external runtime monitor require Control Web release identity rather than treating it as unknown.
5. Add failure-mode coverage for a stale/mismatched Control Web release.
6. Update runtime monitoring documentation so operators know all three surfaces must match the exact candidate.

## Acceptance criteria

- Control Web health returns the configured exact release SHA and returns `null` rather than inventing identity when it is absent.
- Control Web production image exposes the build candidate SHA as `RELEASE_COMMIT` and retains its OCI revision label.
- Container CI fails if any of Cloud API, Event Edge or Control Web reports a different release SHA.
- Runtime monitoring blocks when Control Web is healthy but stale.
- Prometheus release-match output covers all three services without emitting the SHA or endpoint URLs as labels.
- Existing product, Android, SCA, formatting, architecture, recovery and container gates remain green.

## Safety boundary

This strengthens software/deployment provenance only. It does not prove that a real pilot deployment uses the image, does not replace branch protection, and does not satisfy hardware/network/payment/recovery/controlled-pilot evidence gates.
