#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

BACKUP_DIR="$(env_value HOSTINGER_BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/opt/event-commerce/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="$BACKUP_DIR/event-commerce-cloud-$TIMESTAMP.dump"
TMP="$OUTPUT.tmp"

umask 077
install -d -m 0700 "$BACKUP_DIR"
trap 'rm -f "$TMP"' EXIT

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" exec -T postgres pg_dump -U event_commerce -d event_commerce_cloud -Fc >"$TMP"
[[ -s "$TMP" ]] || fail "pg_dump produced an empty backup"
mv "$TMP" "$OUTPUT"
sha256sum "$OUTPUT" >"$OUTPUT.sha256"

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'event-commerce-cloud-*.dump' -o -name 'event-commerce-cloud-*.dump.sha256' \) -mtime +7 -delete

DIGEST="$(cut -d' ' -f1 "$OUTPUT.sha256")"
echo "Backup created: $OUTPUT"
echo "sha256=$DIGEST"
echo "Reminder: copy representative pilot backups to a separate secure failure domain before claiming recovery evidence."
