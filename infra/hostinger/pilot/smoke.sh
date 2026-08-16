#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOSTINGER_ENV_FILE:-$DIR/.env}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
command -v curl >/dev/null 2>&1 || fail "curl is required"

RELEASE_COMMIT="$(env_value RELEASE_COMMIT)"
API_DOMAIN="$(env_value API_DOMAIN)"
CONTROL_DOMAIN="$(env_value CONTROL_DOMAIN)"
[[ "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid RELEASE_COMMIT"

probe() {
  local url="$1"
  local service="$2"
  local body
  body="$(curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 15 "$url")" || fail "$url is not healthy over HTTPS"
  grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$body" || fail "$url did not report status=ok"
  grep -Eq "\"service\"[[:space:]]*:[[:space:]]*\"${service}\"" <<<"$body" || fail "$url did not report service=$service"
  grep -Eq "\"releaseCommit\"[[:space:]]*:[[:space:]]*\"${RELEASE_COMMIT}\"" <<<"$body" || fail "$url does not report exact release $RELEASE_COMMIT"
  echo "PASS $service $url release=$RELEASE_COMMIT"
}

probe "https://${API_DOMAIN}/health" cloud-api
probe "https://${CONTROL_DOMAIN}/api/health" control-web
