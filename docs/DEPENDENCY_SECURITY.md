# Dependency security / SCA evidence

## Purpose

Task 010 SEC-008 requires reproducible evidence that the exact release candidate's third-party dependencies were checked for known vulnerabilities across both the JavaScript workspace and Android build.

The repository uses one fail-closed scanner path based on the OSV.dev API. The gate does not claim that any vulnerability database is complete; it proves that the resolved dependency inventory was actually submitted to the configured advisory source and that the resulting findings were handled according to this release policy.

## Command

After a frozen pnpm install and with Java 17 + Gradle 8.11.1 available:

```bash
pnpm install --frozen-lockfile
pnpm security:sca
```

Evidence is written under `artifacts/sca/` and is intentionally gitignored. The command exits non-zero when the gate fails.

## What is scanned

### pnpm workspace

The scanner reads the resolved installed dependency graph from:

```bash
pnpm list --recursive --json --depth Infinity
```

It records resolved npm package names/versions and dependency scope. Workspace links/file/git dependencies are not treated as registry packages.

A release scan must happen after `pnpm install --frozen-lockfile`; a zero-package npm inventory is a hard failure.

### Android

The Android application exposes the Gradle verification task:

```bash
gradle -q -p apps/pos-android app:scaResolvedDependencies
```

The task walks resolvable runtime/KSP configurations and emits the selected transitive Maven module versions. The scanner also records the pinned Android/Kotlin/KSP Gradle plugin coordinates from `apps/pos-android/build.gradle.kts`.

A zero-package Android/Maven inventory is a hard failure.

## Advisory source

The default endpoint is:

```text
https://api.osv.dev/v1
```

The scanner uses OSV batch package/version queries, follows pagination, then fetches the full advisory record for each returned vulnerability ID. A scanner timeout, invalid response, pagination failure or other API/network error produces `FAIL`; it never produces a clean result.

`SCA_OSV_API_BASE` may be used only with an HTTPS endpoint, for example a reviewed internal mirror/proxy.

## Severity policy

The gate normalizes advisory severities to:

- `LOW`
- `MODERATE`
- `HIGH`
- `CRITICAL`
- `UNKNOWN`

`HIGH`, `CRITICAL` and `UNKNOWN` are release blockers unless a valid exact acceptance exists. `UNKNOWN` is intentionally blocking because absence of usable severity metadata is not evidence of low risk.

The evidence retains moderate/low findings for reviewer visibility even when they do not fail the gate.

## Risk acceptances

Risk acceptances live in `security/sca-acceptances.json`. There is no wildcard ignore switch.

An acceptance must match exactly:

- vulnerability ID;
- ecosystem;
- package name;
- resolved package version.

It must also contain:

- `acceptedAt` — RFC3339 timestamp;
- `expiresAt` — RFC3339 timestamp after `acceptedAt` and no more than 90 days later;
- `approvedBy` — named accountable reviewer/owner;
- `reason` — substantive reason of at least 20 characters.

Example:

```json
{
  "schemaVersion": 1,
  "acceptances": [
    {
      "vulnerabilityId": "GHSA-xxxx-xxxx-xxxx",
      "ecosystem": "npm",
      "packageName": "example-package",
      "version": "1.2.3",
      "acceptedAt": "2026-08-15T08:00:00Z",
      "expiresAt": "2026-09-15T08:00:00Z",
      "approvedBy": "Named security owner",
      "reason": "Bounded pilot exposure with compensating control and scheduled upgrade."
    }
  ]
}
```

Expired, malformed or duplicate acceptances fail validation. Upgrading/downgrading the package invalidates the acceptance automatically because the version no longer matches.

An acceptance is not a remediation. It is time-bounded release evidence that a named person knowingly accepted a specific residual risk.

## Evidence manifest

A normal run writes:

```text
artifacts/sca/sca-evidence-<12-char-commit>.json
```

The manifest contains:

- PASS/FAIL;
- generation timestamp;
- exact 40-character release commit;
- clean/dirty git state;
- OSV endpoint/fail-closed policy;
- Node/pnpm/Java/Gradle/platform metadata;
- complete resolved npm + Maven inventory used for the query;
- vulnerability IDs, normalized severity, aliases, summary/reference metadata;
- whether an exact acceptance applied;
- blocker counts and unused-acceptance visibility;
- validation errors.

A scanner/runtime failure writes `sca-evidence-failed.json` where possible.

The evidence format intentionally contains package/advisory metadata only. Do not add registry tokens, bearer credentials, database URLs, `.env` contents, application rows or other secrets/business data.

## Release acceptance

SEC-008 is not closed merely because this command exists. Release evidence is valid only when all of the following are true on the exact release candidate:

1. frozen pnpm install succeeds;
2. Android dependency resolution succeeds;
3. OSV scan completes without scanner/network error;
4. evidence inventory is non-empty for npm and Maven;
5. no unaccepted HIGH/CRITICAL/UNKNOWN finding remains;
6. any acceptance is valid, exact and unexpired;
7. git state/commit evidence is acceptable for the release process;
8. the JSON manifest is retained with the release evidence pack;
9. a named security/release reviewer signs off the manifest.

## CI

Permanent CI contains a separate `sca` job. It installs with the frozen pnpm lock, resolves Android dependencies, runs `pnpm security:sca`, and uploads `artifacts/sca/*.json` with `if: always()` so a failing vulnerability gate still leaves reviewable evidence.

A GitHub Actions job that never receives a runner is not executed SCA evidence. SEC-007 and SEC-008 therefore remain release blockers until the permanent job actually runs on the exact stacked release commit.

## Remediation workflow

For an unaccepted blocking finding:

1. identify whether the package is direct, transitive, build-only or runtime;
2. prefer upgrading/removing the vulnerable dependency;
3. rerun the frozen install/build/tests and SCA scan;
4. if immediate remediation is impossible, document concrete exploitability/exposure and compensating controls;
5. create an exact short-lived acceptance only with named approval;
6. schedule remediation before expiry;
7. remove stale acceptance entries after the vulnerable version disappears.

Do not suppress scanner/network failures or convert `UNKNOWN` severity into a lower severity to make a release pass.
