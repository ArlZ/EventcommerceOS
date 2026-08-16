# Reliability — container runtime isolation

Status: **in progress**
Base: `main` at `7cad157659f71fd9b381de854657f41b00d67f55`

## Objective

Prove the packaged Cloud API, Event Edge and Control Web production images can run with a read-only root filesystem, no ambient Linux capabilities and no privilege escalation, without changing application semantics or choosing a deployment vendor.

## Scope

1. Strengthen the existing runtime-container CI boot command with:
   - `--read-only`;
   - `--cap-drop ALL`;
   - `--security-opt no-new-privileges:true`.
2. Verify through `docker inspect` that every running production container has those controls applied.
3. Preserve existing database migrations, readiness checks, exact release identity, non-root execution, OCI provenance and Trivy image SCA.
4. Document these controls as deployment requirements for any pilot/runtime platform that supports equivalent settings.

## Acceptance criteria

- Cloud API boots and passes DB-backed readiness with a read-only root filesystem.
- Event Edge boots and passes DB-backed readiness with a read-only root filesystem.
- Control Web boots and passes health with a read-only root filesystem.
- All three runtime containers drop all Linux capabilities.
- All three runtime containers have `no-new-privileges` enabled.
- All three runtime processes remain non-root.
- Exact release identity remains correct for all three services.
- Container Trivy SCA and permanent repository CI remain green.

## Non-goals

- Do not claim Kubernetes/ECS/Cloud Run/nomad-specific policy is configured.
- Do not invent CPU/memory limits without representative load evidence.
- Do not change database/network/provider behavior.
- Do not treat synthetic container isolation as field/pilot evidence.
