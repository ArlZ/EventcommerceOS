#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../.." && pwd)"
ENV_FILE="${HOSTINGER_ENV_FILE:-$DIR/.env}"
COMPOSE_FILE="$DIR/docker-compose.yml"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE. Copy .env.example to .env and fill the placeholders."
command -v git >/dev/null 2>&1 || fail "git is required"
command -v docker >/dev/null 2>&1 || fail "docker is required"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

RELEASE_COMMIT="$(env_value RELEASE_COMMIT)"
API_DOMAIN="$(env_value API_DOMAIN)"
CONTROL_DOMAIN="$(env_value CONTROL_DOMAIN)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
TRAEFIK_NETWORK="$(env_value TRAEFIK_NETWORK)"
SKIP_HTTPS_SMOKE="$(env_value HOSTINGER_SKIP_HTTPS_SMOKE)"
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-traefik-proxy}"
SKIP_HTTPS_SMOKE="${SKIP_HTTPS_SMOKE:-0}"

[[ "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_COMMIT must be a full lowercase 40-character Git SHA"
[[ "$POSTGRES_PASSWORD" =~ ^[0-9a-f]{64}$ ]] || fail "POSTGRES_PASSWORD must be exactly 64 lowercase hex characters (openssl rand -hex 32)"
[[ "$API_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$API_DOMAIN" == *.* ]] || fail "API_DOMAIN must be a hostname without scheme/path"
[[ "$CONTROL_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$CONTROL_DOMAIN" == *.* ]] || fail "CONTROL_DOMAIN must be a hostname without scheme/path"
[[ "$API_DOMAIN" != "$CONTROL_DOMAIN" ]] || fail "API_DOMAIN and CONTROL_DOMAIN must be different"
[[ "$SKIP_HTTPS_SMOKE" == "0" || "$SKIP_HTTPS_SMOKE" == "1" ]] || fail "HOSTINGER_SKIP_HTTPS_SMOKE must be 0 or 1"

CURRENT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
[[ "$CURRENT_COMMIT" == "$RELEASE_COMMIT" ]] || fail "Checked-out Git SHA $CURRENT_COMMIT does not match RELEASE_COMMIT $RELEASE_COMMIT"
[[ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]] || fail "Tracked worktree is dirty; deployment requires an exact clean release checkout"

docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1 || fail "Docker network $TRAEFIK_NETWORK does not exist. Deploy Hostinger's Traefik catalog project first."

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config --quiet

echo "Starting private PostgreSQL..."
"${COMPOSE[@]}" up -d postgres

for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U event_commerce -d event_commerce_cloud >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    fail "PostgreSQL did not become ready"
  fi
  sleep 2
done

echo "Building exact-release application images..."
"${COMPOSE[@]}" build --pull cloud-api control-web

for image in "event-commerce/cloud-api:$RELEASE_COMMIT" "event-commerce/control-web:$RELEASE_COMMIT"; do
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  [[ "$revision" == "$RELEASE_COMMIT" ]] || fail "$image OCI revision $revision does not match $RELEASE_COMMIT"
done

echo "Applying Cloud API migrations before application startup..."
"${COMPOSE[@]}" run --rm --no-deps cloud-api node scripts/migrate.mjs

echo "Starting Cloud API and Event Control..."
"${COMPOSE[@]}" up -d cloud-api control-web

for service in cloud-api control-web; do
  for attempt in $(seq 1 30); do
    container_id="$("${COMPOSE[@]}" ps -q "$service")"
    [[ -n "$container_id" ]] || fail "$service container is missing"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    if [[ "$health" == "healthy" || "$health" == "running" ]]; then
      break
    fi
    if [[ "$health" == "unhealthy" || "$health" == "exited" || "$attempt" == "30" ]]; then
      "${COMPOSE[@]}" logs --tail 100 "$service" >&2 || true
      fail "$service did not become healthy (status=$health)"
    fi
    sleep 2
  done
done

if [[ "$SKIP_HTTPS_SMOKE" == "1" ]]; then
  echo "WARNING: public HTTPS smoke skipped by explicit HOSTINGER_SKIP_HTTPS_SMOKE=1. This is not release evidence."
else
  "$DIR/smoke.sh"
fi

echo "Hostinger pilot deployment completed for release $RELEASE_COMMIT"
