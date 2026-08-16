#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GENERATOR="${ROOT_DIR}/infra/aws/pilot/render-stack.mjs"
TEMPLATE_FILE="$(mktemp)"
trap 'rm -f "${TEMPLATE_FILE}"' EXIT

: "${AWS_REGION:=af-south-1}"
: "${STACK_NAME:=event-commerce-pilot}"
: "${DESIRED_COUNT:=0}"
: "${DATABASE_INSTANCE_CLASS:=db.t4g.micro}"
: "${DATABASE_ENGINE_VERSION:=}"

required=(RELEASE_COMMIT API_DOMAIN CONTROL_DOMAIN CERTIFICATE_ARN)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 2
  fi
done

if [[ "${AWS_REGION}" != "af-south-1" ]]; then
  echo "Pilot stack is locked to AWS Africa (Cape Town): af-south-1" >&2
  exit 2
fi

if [[ ! "${RELEASE_COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_COMMIT must be an exact lowercase 40-character Git SHA" >&2
  exit 2
fi

if [[ "${DESIRED_COUNT}" != "0" && "${DESIRED_COUNT}" != "1" ]]; then
  echo "DESIRED_COUNT must be 0 or 1 for the controlled pilot" >&2
  exit 2
fi

if [[ ! "${CERTIFICATE_ARN}" =~ ^arn:aws[a-zA-Z-]*:acm:af-south-1:[0-9]{12}:certificate/.+ ]]; then
  echo "CERTIFICATE_ARN must identify an ACM certificate in af-south-1" >&2
  exit 2
fi

node "${GENERATOR}" >"${TEMPLATE_FILE}"

aws sts get-caller-identity >/dev/null
aws ec2 describe-availability-zones \
  --region "${AWS_REGION}" \
  --query 'AvailabilityZones[0].ZoneName' \
  --output text >/dev/null

parameter_overrides=(
  "ReleaseCommit=${RELEASE_COMMIT}"
  "ApiDomainName=${API_DOMAIN}"
  "ControlDomainName=${CONTROL_DOMAIN}"
  "CertificateArn=${CERTIFICATE_ARN}"
  "DesiredCount=${DESIRED_COUNT}"
  "DatabaseInstanceClass=${DATABASE_INSTANCE_CLASS}"
)

if [[ -n "${DATABASE_ENGINE_VERSION}" ]]; then
  parameter_overrides+=("DatabaseEngineVersion=${DATABASE_ENGINE_VERSION}")
fi

aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_FILE}" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${parameter_overrides[@]}"

aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table
