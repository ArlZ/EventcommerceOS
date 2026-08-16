# 011 — AWS controlled-pilot deployment foundation

## Objective

Turn the exact validated Event Commerce OS candidate into a deployable controlled-pilot cloud environment in AWS Africa (Cape Town), without changing order, payment, inventory, sync or reconciliation semantics.

## Deployment boundary

Cloud:

- AWS Region `af-south-1` (Africa / Cape Town).
- ECS on Fargate for Cloud API and Control Web.
- Application Load Balancer with HTTPS and host-based routing.
- Amazon RDS for PostgreSQL in isolated database subnets.
- AWS Secrets Manager for generated database credentials and M-PESA sandbox credentials.
- Amazon ECR for immutable release-tagged images.
- CloudWatch logs, Container Insights and basic pilot alarms.

Venue:

- Event Edge remains physically at the venue.
- Android POS devices continue to trade against Event Edge over the local event network.
- Cloud failure must not become a synchronous checkout dependency.

## Pilot topology choices

1. Two public subnets host only the internet-facing ALB and one NAT Gateway.
2. Cloud API and Control Web run in two private application subnets with no public IPs.
3. PostgreSQL runs in two isolated database subnets and is not publicly reachable.
4. Pilot services are capped at one task each. The application remains in `single_instance_pilot` abuse mode.
5. One NAT Gateway is intentionally used for Pilot 1 cost control. A larger production topology must move to per-AZ egress or equivalent resilient outbound networking.
6. RDS is Single-AZ for the controlled pilot because Event Edge preserves local trading continuity. A larger event requires an explicit availability/cost review.
7. Services default to desired count `0` so infrastructure can be created, images pushed and Cloud migrations completed before any internet-facing application task starts.
8. M-PESA is sandbox-only until the payment-fault matrix and reconciliation gates pass.

## Release discipline

- `ReleaseCommit` must be an exact 40-character lowercase Git SHA.
- ECR repositories use immutable tags.
- Cloud API and Control Web images are built from the repository root and tagged with the exact release SHA.
- The Control Web image is built with the exact HTTPS Cloud API origin.
- Cloud migrations run as a one-off Fargate task from the same Cloud API release image.
- Only after migration succeeds are both services raised from desired count `0` to `1`.
- Health checks must return the deployed release identity.

## Implementation

- [x] Add native CloudFormation pilot stack generator.
- [x] Add non-secret deployment parameter example.
- [x] Add stack deployment, image build/push, migration and smoke scripts.
- [x] Add repository tests for pilot-infrastructure safety invariants.
- [ ] Obtain/enable AWS account access and `af-south-1`.
- [ ] Choose pilot DNS names and obtain an ACM certificate in `af-south-1`.
- [ ] Deploy the stack at desired count `0`.
- [ ] Point DNS to the ALB.
- [ ] Build and push exact-release images.
- [ ] Run Cloud migrations.
- [ ] Populate M-PESA sandbox credentials in Secrets Manager.
- [ ] Raise desired count to `1`.
- [ ] Run exact-release smoke checks.
- [ ] Provision Event Edge and Android POS hardware.
- [ ] Run offline/restart/payment/inventory/restore/abuse rehearsal.
- [ ] Run one deliberately small controlled live pilot.

## Non-goals

This task does not:

- make Event Edge a cloud service;
- change payment or transaction business rules;
- introduce Redis, queues or microservices;
- enable live-money M-PESA;
- declare the product festival-ready;
- close release evidence issue #24.

## Known pilot trade-offs

- Single NAT Gateway: lower cost, but outbound cloud traffic has an AZ dependency.
- Single-AZ RDS: acceptable only because this is a bounded pilot and venue trading is local-first.
- Runtime database connection currently uses the generated RDS master credential. Before materially larger production, create a least-privilege application database role and separate migration/runtime credentials.
- Branch protection issue #23 remains an independent governance blocker.
