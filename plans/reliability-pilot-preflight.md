# Reliability — Exact-release pilot deployment preflight

Status: **in progress**
Base: `main` at `a34b04425525da56bc10fe6402fb06e4e8458db5`

## Objective

Add an executable, fail-closed preflight that operators run on the exact controlled-pilot release before starting representative hardware, network, abuse, payment and recovery exercises.

The preflight must reduce avoidable field-test mistakes without pretending to satisfy any real-world evidence gate. A passing preflight means only that the candidate identity, non-secret deployment contract, pilot evidence manifest and deployed Cloud/Event Edge health endpoints are internally consistent enough to begin the real exercises.

## Scope

1. Expose the configured exact release commit in Cloud API and Event Edge health responses without exposing secrets.
2. Add `scripts/pilot-preflight.mjs` to verify:
   - a valid exact release SHA;
   - clean tracked release checkout when Git metadata is available;
   - a structurally ready pilot evidence manifest bound to the same release;
   - named pilot owners and deployment mode;
   - valid abuse-protection deployment configuration;
   - Cloud and Event Edge health endpoints are reachable, identify the expected service, and report the exact release commit;
   - non-local health URLs use TLS.
3. Produce a deterministic JSON evidence report with PASS/BLOCKED status and SHA-256 digest. The report must contain no credentials or authorization material.
4. Add permanent tests for pass/fail behavior, release mismatch, invalid deployment configuration and missing pilot ownership.
5. Document when to run preflight and make explicit that it cannot mark hardware, payment, abuse, restore, inventory-close or controlled-pilot gates PASS.

## Acceptance criteria

- `pnpm pilot:preflight` exits non-zero on any required preflight failure.
- A missing/mismatched `RELEASE_COMMIT` from either deployed service blocks the preflight.
- `upstream_distributed` blocks unless upstream protection is confirmed and at least one trusted proxy hop is configured.
- A pilot evidence manifest with missing named owners or a different release SHA blocks the preflight.
- Remote non-local HTTP health URLs are rejected; localhost HTTP remains usable for development/test.
- PASS output records the release commit/tree, deployment mode, endpoint identities and a SHA-256 digest without retaining secrets.
- Existing pilot-evidence validation remains fail-closed and independent; preflight never changes a field gate status.
- Repository TypeScript, Android, SCA, formatting and architecture gates remain green.

## Non-goals

- Do not fabricate representative backup/restore evidence.
- Do not simulate named human review/sign-off.
- Do not substitute health reachability for supported-device/network testing.
- Do not substitute preflight for payment-provider sandbox/live fault testing.
- Do not close SEC-009 while GitHub branch protection remains unavailable for the private repository/account configuration.
- Do not upgrade Kotlin to an unstable channel solely to remove the tracked build-tooling advisory.

## Validation

Permanent CI on the final PR candidate must pass the existing TypeScript, Android and SCA jobs. The new preflight tests run as part of the root test command. Field execution remains a separate post-merge activity using `docs/PILOT_RUNBOOK.md` and `docs/PILOT_EVIDENCE.md`.
