# AWS controlled-pilot deployment

This directory contains the first real cloud deployment path for Event Commerce OS.

It is intentionally a **controlled-pilot** topology, not the final large-festival topology.

## Architecture

```text
Internet
   |
   v
Application Load Balancer (public, HTTPS)
   | host: api.<domain>
   |------------------------------> Cloud API / ECS Fargate (private app subnets)
   |                                      |
   |                                      v
   |                               RDS PostgreSQL (isolated DB subnets)
   |
   | host: control.<domain>
   `------------------------------> Control Web / ECS Fargate (private app subnets)

Private app subnets --> single pilot NAT Gateway --> ECR / CloudWatch / Secrets Manager / M-PESA sandbox
```

Event Edge does **not** run in this AWS stack. It remains at the event venue and Android POS devices trade locally through it.

## Why Cape Town

The deployment scripts fail closed unless `AWS_REGION=af-south-1`. The generated CloudFormation template also conditions every resource on `AWS::Region == af-south-1`, so manually applying it in another region creates no pilot resources. Cape Town is an opt-in AWS region, so it must first be enabled on the AWS account.

## Prerequisites

- AWS CLI v2 authenticated to the pilot AWS account.
- `af-south-1` enabled.
- Docker with `buildx`.
- Two DNS hostnames, for example:
  - `api.pilot.example.com`
  - `control.pilot.example.com`
- An ACM certificate **in `af-south-1`** covering both hostnames.
- Permission to create VPC, NAT Gateway, ALB, ECS/Fargate, ECR, RDS, Secrets Manager, CloudWatch and IAM resources.

No production or sandbox credential should be committed to this repository.

## 1. Prepare local deployment variables

```bash
cp infra/aws/pilot/pilot.env.example infra/aws/pilot/pilot.env
```

Edit the copy locally. Do not commit it.

The exact release SHA should normally be the current validated `main` SHA.

## 2. Create infrastructure with applications stopped

```bash
set -a
source infra/aws/pilot/pilot.env
set +a

DESIRED_COUNT=0 infra/aws/pilot/deploy-stack.sh
```

The stack creates:

- two public subnets;
- two private application subnets;
- two isolated database subnets;
- one pilot NAT Gateway;
- private ECS/Fargate tasks;
- encrypted RDS PostgreSQL with seven-day automated backups;
- generated DB credentials in Secrets Manager;
- an empty M-PESA sandbox secret;
- immutable ECR repositories;
- HTTPS ALB routing;
- CloudWatch log groups and basic alarms.

The Cloud API and Control Web services are created with zero running tasks.

## 3. Configure DNS

Read the `LoadBalancerDnsName` stack output and create CNAME/alias records for both pilot hostnames.

Do not start the services until both names resolve to the ALB and the certificate is valid.

## 4. Build and push the exact release

```bash
infra/aws/pilot/build-and-push.sh
```

The script:

- refuses a non-40-character release SHA;
- checks that the local Git HEAD matches `RELEASE_COMMIT`;
- builds Linux/amd64 images from the repository Dockerfile;
- bakes the exact HTTPS Cloud API origin into Control Web;
- tags both images with the immutable release SHA;
- pushes to the stack-created ECR repositories.

## 5. Run Cloud migrations

```bash
infra/aws/pilot/run-migrations.sh
```

Migrations run in a one-off Fargate task using the **same Cloud API image and exact release tag** that will serve traffic.

A migration failure stops deployment.

## 6. Add M-PESA sandbox credentials

The stack output `MpesaSecretArn` points to a JSON secret with these keys:

```json
{
  "consumerKey": "",
  "consumerSecret": "",
  "businessShortCode": "",
  "passkey": ""
}
```

Update those values in AWS Secrets Manager. Keep the API configured against Safaricom sandbox until the controlled payment-fault matrix passes.

The callback URL is automatically:

```text
https://<API_DOMAIN>/payments/providers/mpesa/callback
```

## 7. Start the pilot services

Re-run the same stack with one task per service:

```bash
DESIRED_COUNT=1 infra/aws/pilot/deploy-stack.sh
```

Pilot infrastructure deliberately prevents a desired count above `1`; moving beyond that requires revisiting distributed abuse/rate-limit enforcement.

## 8. Smoke the exact release

```bash
infra/aws/pilot/smoke.sh
```

This verifies both HTTPS health endpoints and checks that each reports the exact `RELEASE_COMMIT`.

## 9. Continue to venue validation

Passing cloud smoke is **not** pilot approval. Continue with `docs/PILOT_RUNBOOK.md`:

- Event Edge hardware and UPS;
- event LAN/Wi-Fi;
- Android devices;
- M-PESA fault matrix;
- 100+ committed offline orders plus device restarts;
- reconnect with zero lost orders and zero duplicate business effects;
- stock opening/transfers/counts;
- backup/isolated restore;
- abuse/flood exercise;
- Event Close and reconciliation;
- deliberately small controlled live pilot.

## Production upgrade items

Before a materially larger event, explicitly review:

- one NAT Gateway per AZ or equivalent resilient egress;
- Multi-AZ RDS;
- least-privilege DB runtime role separate from migration/admin;
- WAF/upstream distributed abuse controls if Cloud API scales above one task;
- alert delivery destinations and on-call ownership;
- branch protection / issue #23;
- successful controlled-pilot evidence / issue #24.
