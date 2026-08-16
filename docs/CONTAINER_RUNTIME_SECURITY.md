# Container runtime security contract

The production images for Cloud API, Event Edge and Control Web are designed to run with restrictive container settings. These settings reduce the impact of an application compromise and should be treated as deployment requirements where the target platform supports equivalent controls.

## Required runtime controls

For all three production services:

- run as the non-root user baked into the image;
- use a read-only root filesystem;
- drop all Linux capabilities;
- disable privilege escalation / enable `no-new-privileges`;
- inject secrets through the deployment secret mechanism rather than image layers or source control;
- provide the exact release identity and the production endpoint/database configuration required by the service;
- keep service health endpoints reachable only through the intended monitoring/ingress path.

The repository runtime-container workflow proves the packaged services boot and pass their health/readiness checks with the first four controls applied. It also verifies exact release identity, OCI provenance and fail-closed image vulnerability scanning.

## Docker-equivalent example

The CI contract uses the equivalent of:

```bash
docker run \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  ...
```

Use the equivalent native settings when deploying through another container orchestrator. Do not weaken these controls silently; document any platform exception and review it as part of release security sign-off.

## Deliberate non-claims

This contract does not choose a hosting provider, configure network policy, define production CPU/memory limits, prove TLS/DNS/ingress configuration, or satisfy real-event hardware/network/payment/recovery evidence. Resource limits should be set from representative load evidence rather than invented in source control.
