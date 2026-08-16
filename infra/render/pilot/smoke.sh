#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT:?Set RELEASE_COMMIT to the exact 40-character deployed Git SHA}"
: "${CLOUD_ORIGIN:?Set CLOUD_ORIGIN to the canonical HTTPS Cloud API origin}"
: "${CONTROL_ORIGIN:?Set CONTROL_ORIGIN to the canonical HTTPS Event Control origin}"

if [[ ! "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_COMMIT must be a full lowercase 40-character Git SHA" >&2
  exit 2
fi

validate_origin() {
  local label="$1"
  local value="$2"
  node - "$label" "$value" <<'NODE'
const [label, value] = process.argv.slice(2);
const parsed = new URL(value);
if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error(`${label} must be a canonical HTTPS origin without credentials, path, query or fragment`);
}
NODE
}

probe() {
  local url="$1"
  local expected_service="$2"
  local body
  body="$(curl --fail --silent --show-error --max-time 10 -H 'accept: application/json' "$url")"
  node - "$body" "$expected_service" "$RELEASE_COMMIT" <<'NODE'
const [raw, expectedService, expectedRelease] = process.argv.slice(2);
const body = JSON.parse(raw);
if (body.status !== 'ok') throw new Error(`${expectedService} health is not ok`);
if (body.service !== expectedService) throw new Error(`expected ${expectedService}, got ${body.service}`);
if (body.releaseCommit !== expectedRelease) {
  throw new Error(`${expectedService} release mismatch: expected ${expectedRelease}, got ${body.releaseCommit}`);
}
NODE
  echo "PASS ${expected_service}: ${url} release=${RELEASE_COMMIT}"
}

validate_origin CLOUD_ORIGIN "$CLOUD_ORIGIN"
validate_origin CONTROL_ORIGIN "$CONTROL_ORIGIN"
probe "${CLOUD_ORIGIN}/health" cloud-api
probe "${CONTROL_ORIGIN}/api/health" control-web
