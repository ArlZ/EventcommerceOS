#!/usr/bin/env bash
set -euo pipefail

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

output() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

api_url="$(output ApiUrl)"
control_url="$(output ControlUrl)"

api_health="$(curl --fail --silent --show-error --max-time 10 "${api_url}/health")"
web_health="$(curl --fail --silent --show-error --max-time 10 "${control_url}/api/health")"

node - "${RELEASE_COMMIT}" "${api_health}" "${web_health}" <<'NODE'
const [, , expected, apiRaw, webRaw] = process.argv;

for (const [name, raw] of [
  ['Cloud API', apiRaw],
  ['Control Web', webRaw],
]) {
  const body = JSON.parse(raw);
  if (body.releaseCommit !== expected) {
    throw new Error(
      `${name} health release mismatch: expected ${expected}, observed ${String(body.releaseCommit)}`,
    );
  }
  console.log(`${name}: healthy on ${expected}`);
}
NODE
