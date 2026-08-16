# Security — generated evidence artifact hygiene

Status: **implemented; awaiting exact-head CI**
Base: `main` at `98ee602874cc2aff3c4098fa25425572afb110ec`

## Objective

Prevent generated pilot and container-security evidence from being accidentally committed to the source repository.

## Scope

1. Align `.gitignore` with the actual `artifacts/pilot/` paths used by pilot evidence and preflight commands.
2. Ignore generated `artifacts/container-sca/` JSON reports produced by the runtime-container security workflow.
3. Preserve existing ignores for dependency SCA, backup/restore and legacy pilot-evidence paths.
4. Document that operational evidence should be retained in the designated evidence store/workflow artifacts, not source control.

## Acceptance criteria

- `artifacts/pilot/` is ignored.
- `artifacts/container-sca/` is ignored.
- existing generated-evidence ignore rules remain intact.
- no evidence file is added to Git.
- permanent CI remains green.

## Implementation notes

- The default `artifacts/pilot-evidence/` path remains ignored for compatibility with the manifest initializer.
- The runbook/example `artifacts/pilot/` path is now ignored explicitly.
- Generated container SCA JSON under `artifacts/container-sca/` is ignored locally while CI retains its own workflow artifact.
- Pilot evidence documentation now states that operational evidence belongs in the approved evidence store rather than source control.

## Non-goals

- Do not delete or rewrite existing Git history.
- Do not move evidence into the repository.
- Do not change pilot evidence validation semantics.
