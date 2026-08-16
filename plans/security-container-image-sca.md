# Security — production container image SCA

Status: **implemented; awaiting exact-head CI**
Rebased base: `main` at `211f78b1fcbd87a5c9561893221e94b782b76738`

## Objective

Extend fail-closed third-party vulnerability assurance from the resolved npm/Android dependency graphs to the actual production Cloud API, Event Edge and Control Web container images.

## Scope

1. Install a reviewed, commit-pinned Trivy setup action in the existing runtime-container workflow.
2. Pin the Trivy scanner version explicitly rather than using `latest`.
3. Scan all three locally built production images for OS and library vulnerabilities.
4. Block on `UNKNOWN`, `HIGH` or `CRITICAL` findings, matching the existing dependency-security blocking philosophy.
5. Do not ignore unfixed findings automatically.
6. Retain a JSON report for each image even when another image has a blocking finding or scanner failure.
7. Upload image-SCA evidence with `if: always()` and fail the workflow after evidence collection if any scan did not succeed.
8. Keep scanner/network/setup failures fail-closed.
9. Remediate inherited runtime-base blockers without suppressions and keep the replacement base digest-pinned.
10. Document what this scan proves and what it does not prove.

## Acceptance criteria

- Cloud API, Event Edge and Control Web images are scanned after the exact images used for runtime smoke are built.
- Scanner action references are immutable 40-character commit SHAs and pass `scripts/check-workflow-pins.mjs`.
- Trivy version is explicit and reviewed.
- Each service produces an individual JSON report under `artifacts/container-sca/`.
- `UNKNOWN`, `HIGH` and `CRITICAL` findings fail the image-SCA gate.
- `ignore-unfixed` is not enabled.
- A scanner/setup/network error cannot become a clean result.
- Evidence upload still runs when a scan finds blockers.
- The final runtime base is immutable and contains no unneeded npm/Corepack/Yarn package-manager payload.
- Existing image provenance, packaged migrations, boot/readiness, exact-release and non-root checks remain intact.
- Existing TypeScript, Android, dependency-SCA, formatting, architecture and recovery checks remain green.

## Implementation notes

- The workflow installs `aquasecurity/setup-trivy` by immutable commit SHA and selects Trivy `v0.74.0` explicitly.
- Setup and individual scans use `continue-on-error` only to preserve evidence breadth and allow the already-built runtime candidate to complete its smoke validation.
- A final `if: always()` enforcement step inspects setup/scan outcomes and fails unless all four outcomes are `success`.
- JSON evidence upload also runs with `if: always()`.
- No `ignore-unfixed`, `.trivyignore`, wildcard suppression or pre-emptive risk acceptance is introduced.
- The first scan of the old Node 22.23.1 Debian runtime found 41 identical blockers in every image: 33 OS findings and 8 package-manager/tooling findings. No app-specific blocker was present.
- The replacement base is Node 22.23.2 Alpine 3.24 pinned to `sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`.
- Final runtime stages remove npm, Corepack, pnpm/Yarn shims and the bundled Yarn payload; build tooling remains in build stages.
- Diagnostic Trivy v0.74.0 JSON evidence reported zero blocking vulnerabilities for the Alpine OS and Node package targets in all three images, while migrations, boot, release identity and non-root checks remained green.

## Non-goals

- Do not introduce wildcard `.trivyignore` suppressions.
- Do not create risk acceptances before an actual blocker is observed and assessed.
- Do not claim container scanning proves runtime configuration, network, hardware, provider or controlled-pilot safety.
- Do not publish images or select a production registry/hosting provider in this slice.
