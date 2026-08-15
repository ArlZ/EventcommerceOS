# Security — pin CI supply-chain dependencies

Status: **in progress**
Original base: `main` at `58dca72842aeb900334d614d4f8caa21e651f6b2`
Integration base: `main` at `ea868dd00a884bf1f930847ee7b025a7e747ca9e`

## Objective

Make repository CI and recovery-smoke execution reproducible by replacing moving third-party GitHub Action tags and mutable PostgreSQL service tags with the exact immutable revisions already resolved by current green workflows, while minimizing credential exposure inside checked-out build workspaces.

## Scope

1. Pin every third-party GitHub Action in `ci.yml` and `recovery-smoke.yml` to its exact commit SHA while retaining a human-readable major-version comment.
2. Pin PostgreSQL 16 Alpine service containers in both workflows to the exact image digest observed in current successful workflow runs.
3. Set checkout `persist-credentials: false` so the GitHub token is not left in local Git configuration for later build/test steps.
4. Preserve current permissions, job behavior, versions and test commands.
5. Validate that the pinned workflows still execute successfully.

## Pinned revisions

- `actions/checkout` v6: `d23441a48e516b6c34aea4fa41551a30e30af803`
- `pnpm/action-setup` v6: `0977fd99725f1db4007ccb2928dbb4e90d06cc86`
- `actions/setup-node` v6: `249970729cb0ef3589644e2896645e5dc5ba9c38`
- `actions/setup-java` v5: `b6effb05e454b25005698d916606bdc6ffcbf961`
- `gradle/actions/setup-gradle` v5: `0723195856401067f7a2779048b490ace7a47d7c`
- `actions/upload-artifact` v6: `ea165f8d65b6e75b540449e92b4886f43607fa02`
- PostgreSQL 16 Alpine image digest: `sha256:44c4ee9810eff91f7eab4d822642e01115b1a9eccce4bcbdde7604752d68eac6`

## Acceptance criteria

- No `uses:` entry in either workflow relies on a floating major-version tag.
- Workflow PostgreSQL services no longer rely on an unpinned image tag.
- Checkout credentials are not persisted into the working repository.
- Existing least-privilege `contents: read` permissions remain unchanged.
- TypeScript, Android, SCA and recovery-smoke execution remain green with the pinned dependencies.

## Non-goals

- Do not change application dependency versions.
- Do not change Android/Gradle/Node versions.
- Do not broaden GitHub token permissions.
