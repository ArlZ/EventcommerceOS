# Production container security scan

## Purpose

The repository already performs fail-closed software-composition analysis for the resolved pnpm and Android/Maven dependency graphs. Production runtime images add another dependency surface: operating-system packages and libraries present in the final Cloud API, Event Edge and Control Web containers.

The runtime-container workflow therefore scans the exact locally built production images with Trivy before the candidate can pass the image gate.

This is software-composition evidence for the image contents. It does not prove runtime configuration, network isolation, hardware safety, payment-provider behavior or controlled-pilot readiness.

## Runtime base remediation

The first image scan of the previous digest-pinned Debian 12 / Node 22.23.1 runtime found the same 41 release-blocking findings in all three images: 33 operating-system findings and 8 Node package-manager/tooling findings. The identical result across Cloud API, Event Edge and Control Web showed that these findings were inherited from the shared runtime base rather than application-specific dependencies.

The findings were remediated without suppressions by moving the shared runtime to the official Node 22.23.2 Alpine 3.24 image and minimizing the final runtime contents. The base is pinned to the exact manifest resolved and exercised by CI:

```text
node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
```

Final runtime stages remove package-manager tooling that the services never execute: npm, Corepack, pnpm/Yarn shims and the bundled Yarn payload. Build tooling remains confined to the build stages.

A diagnostic scan of this exact Alpine runtime with the same blocking policy reported zero vulnerabilities in both the Alpine OS package target and Node language-package target for Cloud API, Event Edge and Control Web, while packaged migrations, service boot, exact release identity and non-root execution still passed.

## Scanner

The workflow installs Trivy through a commit-pinned `aquasecurity/setup-trivy` GitHub Action and explicitly selects Trivy `v0.74.0` rather than using `latest`.

The setup action is referenced by immutable commit SHA so `scripts/check-workflow-pins.mjs` continues to reject mutable workflow action references.

Scanner caching is disabled in this workflow. A scanner installation or vulnerability-database/network failure is not interpreted as a clean image.

## Images scanned

The workflow scans the same exact images that are subsequently used for packaged migrations and runtime smoke:

- `event-commerce-cloud-api:${GITHUB_SHA}`;
- `event-commerce-event-edge:${GITHUB_SHA}`;
- `event-commerce-control-web:${GITHUB_SHA}`.

The image build has already verified each image's OCI source/revision labels before scanning.

## Blocking policy

Each image is scanned for both OS packages and application/library packages discoverable in the final image.

The release-blocking severity set is `UNKNOWN`, `HIGH` and `CRITICAL`. This matches the repository's existing dependency-security principle that missing usable severity metadata is not evidence of low risk.

Unfixed vulnerabilities are **not** automatically ignored. There is no wildcard `.trivyignore` in this gate.

If a real blocking finding is discovered, first determine whether it can be removed by updating the digest-pinned Node base image, changing the runtime package set or upgrading/removing the affected dependency. A risk acceptance must not be invented pre-emptively merely to make CI green.

## Evidence retention

Each scan writes JSON under `artifacts/container-sca/` for Cloud API, Event Edge and Control Web. CI uploads the reports as a single `container-sca-<Git SHA>` artifact with `if: always()`.

The individual scan steps use `continue-on-error` only so a blocker in one image does not prevent the other reports from being produced and does not prevent the already-built candidate from completing its packaged runtime smoke. A final enforcement step runs with `if: always()` and fails unless Trivy setup and all three scans succeeded.

A skipped scan, scanner crash, setup failure, database/network failure or blocking vulnerability therefore cannot produce a successful image-SCA gate.

## Relationship to runtime validation

A candidate must still pass the existing runtime-container checks: digest-pinned production build, OCI source/revision identity, packaged migrations, boot of all three images, health/readiness, exact `RELEASE_COMMIT` across all three surfaces and non-root execution.

Image scanning does not replace any of these checks. Conversely, a bootable container is not considered vulnerability-clean merely because the runtime smoke passed.

## Final-main evidence

The runtime-container workflow runs for matching pull requests and again after deployable changes land on `main`. The post-merge run therefore scans and exercises images carrying the final integrated `main` SHA rather than relying only on GitHub's temporary pull-request merge SHA.

That final-main synthetic evidence still does not replace the real deployment and human evidence required by `docs/PILOT_RUNBOOK.md` and `docs/MVP_ACCEPTANCE.md`.
