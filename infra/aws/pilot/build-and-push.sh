#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

: "${AWS_REGION:=af-south-1}"
: "${STACK_NAME:=event-commerce-pilot}"

if [[ -z "${RELEASE_COMMIT:-}" ]]; then
  echo "Missing RELEASE_COMMIT" >&2
  exit 2
fi
if [[ ! "${RELEASE_COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_COMMIT must be an exact lowercase 40-character Git SHA" >&2
  exit 2
fi
if [[ "${AWS_REGION}" != "af-south-1" ]]; then
  echo "Pilot image publishing is locked to af-south-1" >&2
  exit 2
fi

git_head="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
if [[ "${git_head}" != "${RELEASE_COMMIT}" ]]; then
  echo "Local Git HEAD ${git_head} does not match RELEASE_COMMIT ${RELEASE_COMMIT}" >&2
  exit 2
fi

output() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

api_repo="$(output CloudApiRepositoryUri)"
web_repo="$(output ControlWebRepositoryUri)"
api_url="$(output ApiUrl)"

if [[ "${api_repo}" == "None" || "${web_repo}" == "None" || "${api_url}" == "None" ]]; then
  echo "Required CloudFormation outputs are missing" >&2
  exit 3
fi

registry="${api_repo%%/*}"
aws ecr get-login-password --region "${AWS_REGION}" |
  docker login --username AWS --password-stdin "${registry}"

docker buildx inspect >/dev/null

docker buildx build \
  --platform linux/amd64 \
  --target cloud-api \
  --build-arg "RELEASE_COMMIT=${RELEASE_COMMIT}" \
  --build-arg "NEXT_PUBLIC_CLOUD_API_URL=${api_url}" \
  --tag "${api_repo}:${RELEASE_COMMIT}" \
  --push \
  "${ROOT_DIR}"

docker buildx build \
  --platform linux/amd64 \
  --target control-web \
  --build-arg "RELEASE_COMMIT=${RELEASE_COMMIT}" \
  --build-arg "NEXT_PUBLIC_CLOUD_API_URL=${api_url}" \
  --tag "${web_repo}:${RELEASE_COMMIT}" \
  --push \
  "${ROOT_DIR}"

echo "Published exact release ${RELEASE_COMMIT}"
